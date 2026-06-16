/**
 * Duplica los artefactos de otra cotización dentro de la cotización actual.
 *
 * POST /api/presupuestos/{id}/artefactos/importar-de
 *   body: { sourceBudgetId: string, refreshPrices?: boolean }
 *
 * Copia todos los ArtefactoItem del presupuesto origen al actual: nombre,
 * marca, detalle, recinto, subcategoría, cantidad, link, imagen, descuento
 * y el vínculo al catálogo BLARQ (catalogId).
 *
 * Si refreshPrices = true (default), después de copiar revisa cada link
 * online y actualiza el precio lista al del momento — porque al traer una
 * cotización vieja los precios casi siempre cambiaron. El descuento se
 * mantiene (es lo pactado con el proveedor, no está en la web) y el
 * clientPrice se recalcula con el precio fresco.
 *
 * Los items que no tengan link, o cuyo link no responda, quedan con el
 * precio viejo y se reportan en `pendientes` para que MJ los revise.
 *
 * NO sincroniza con el catálogo BLARQ global — duplicar es una operación
 * local de esta cotización; el catálogo se actualiza editando item a item.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { revisarArtefactosOnline } from "@/lib/catalog/revisarArtefactos";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const body = await request.json();
    const sourceBudgetId: string | undefined = body.sourceBudgetId;
    const refreshPrices: boolean = body.refreshPrices !== false;

    if (!sourceBudgetId) {
      return NextResponse.json(
        { error: "Falta sourceBudgetId" },
        { status: 400 }
      );
    }
    if (sourceBudgetId === budgetVersionId) {
      return NextResponse.json(
        { error: "No se puede duplicar una cotización sobre sí misma" },
        { status: 400 }
      );
    }

    const source = await prisma.budgetVersion.findUnique({
      where: { id: sourceBudgetId },
      include: { artefactoItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (!source || source.type !== "artefactos") {
      return NextResponse.json(
        { error: "La cotización origen no existe o no es de artefactos" },
        { status: 404 }
      );
    }
    if (source.artefactoItems.length === 0) {
      return NextResponse.json(
        { error: "La cotización origen no tiene artefactos" },
        { status: 400 }
      );
    }

    // sortOrder arranca después de lo que ya tenga la cotización actual,
    // así los items duplicados se agregan al final sin pisar los existentes.
    const last = await prisma.artefactoItem.findFirst({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    let nextSortOrder = last ? last.sortOrder + 1 : 0;

    // 1. Copiar los items tal cual del origen.
    const createdItems = [];
    for (const it of source.artefactoItems) {
      const created = await prisma.artefactoItem.create({
        data: {
          budgetVersionId,
          room: it.room,
          subcategory: it.subcategory,
          name: it.name,
          detail: it.detail,
          brand: it.brand,
          quantity: it.quantity,
          listPrice: it.listPrice,
          discountPercent: it.discountPercent,
          clientPrice: it.clientPrice,
          // El costo real BLARQ NO se copia: es la cotización privada de
          // la vendedora para ESE proyecto, no aplica al nuevo.
          realCostBlarq: null,
          referenceLink: it.referenceLink,
          imageUrl: it.imageUrl,
          catalogId: it.catalogId,
          sortOrder: nextSortOrder++,
        },
      });
      createdItems.push(created);
    }

    const report = {
      copied: createdItems.length,
      priceUpdated: 0,
      imageUpdated: 0,
      pendientes: [] as { name: string; motivo: string }[],
    };

    // 2. Refrescar precios online (si corresponde).
    if (refreshPrices) {
      const { diffs, skippedNoLink } = await revisarArtefactosOnline(
        createdItems.map((i) => ({
          id: i.id,
          name: i.name,
          room: i.room,
          referenceLink: i.referenceLink,
          listPrice: i.listPrice,
          imageUrl: i.imageUrl,
        }))
      );

      // Los items sin link no se pueden revisar — los reportamos como
      // pendientes para que MJ les cargue precio/link a mano.
      if (skippedNoLink > 0) {
        for (const it of createdItems) {
          if (!it.referenceLink || it.referenceLink.trim().length === 0) {
            report.pendientes.push({
              name: it.name,
              motivo: "Sin link — cargá precio y link manualmente.",
            });
          }
        }
      }

      for (const diff of diffs) {
        if (diff.error || !diff.fetched) {
          report.pendientes.push({
            name: diff.name,
            motivo: diff.error ?? "No se pudo leer el producto.",
          });
          continue;
        }
        const item = createdItems.find((i) => i.id === diff.itemId);
        if (!item) continue;

        const updateData: {
          listPrice?: number;
          clientPrice?: number;
          imageUrl?: string;
        } = {};

        const newPrice = diff.fetched.listPrice;
        if (newPrice && newPrice > 0 && newPrice !== item.listPrice) {
          updateData.listPrice = newPrice;
          // clientPrice unitario = lista × (1 - descuento). El descuento
          // se mantiene del origen.
          updateData.clientPrice =
            newPrice * (1 - (item.discountPercent ?? 0));
          report.priceUpdated++;
        }

        // Si el item venía sin imagen y la tienda tiene una, la traemos.
        if (!item.imageUrl && diff.fetched.imageUrl) {
          updateData.imageUrl = diff.fetched.imageUrl;
          report.imageUpdated++;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.artefactoItem.update({
            where: { id: item.id },
            data: updateData,
          });
        }
      }
    }

    // Devolvemos los items finales (ya con los precios refrescados) para
    // que el editor los agregue a su estado local sin recargar la página.
    const items = await prisma.artefactoItem.findMany({
      where: {
        budgetVersionId,
        id: { in: createdItems.map((i) => i.id) },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ ...report, items });
  } catch (error) {
    console.error("Error duplicando artefactos:", error);
    return NextResponse.json(
      { error: "Error al duplicar artefactos" },
      { status: 500 }
    );
  }
}
