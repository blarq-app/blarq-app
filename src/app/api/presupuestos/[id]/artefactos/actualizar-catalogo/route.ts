/**
 * Diff entre los artefactos de una cotización y su producto del catálogo BLARQ.
 *
 * GET /api/presupuestos/{id}/artefactos/actualizar-catalogo
 *   Para cada artefacto linkeado al catálogo (catalogId no nulo), compara el
 *   costo interno, el precio a cliente y la foto/link de la cotización con los
 *   del catálogo, y devuelve un diff. NO escribe nada — la UI decide qué bajar.
 *
 * Es la contracara de "Revisar precios online": en vez de mirar la tienda web,
 * mira la lista maestra de BLARQ (el catálogo). El catálogo es la fuente de
 * verdad; cada cotización guarda una foto del precio/costo del momento en que
 * se agregó el artefacto, así que al cambiar el catálogo las cotizaciones
 * viejas quedan desactualizadas hasta que se bajan los datos con este botón.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;

    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId },
      select: {
        id: true,
        name: true,
        room: true,
        catalogId: true,
        listPrice: true,
        clientPrice: true,
        realCostBlarq: true,
        imageUrl: true,
        referenceLink: true,
      },
    });

    const linked = items.filter((i) => i.catalogId);
    const skippedNoCatalog = items.length - linked.length;

    const catIds = [
      ...new Set(linked.map((i) => i.catalogId).filter(Boolean) as string[]),
    ];
    const cats = await prisma.artefactoCatalog.findMany({
      where: { id: { in: catIds } },
      select: {
        id: true,
        name: true,
        listPrice: true,
        discountPercent: true,
        clientPrice: true,
        realCostBlarq: true,
        imageUrl: true,
        referenceLink: true,
      },
    });
    const catById = new Map(cats.map((c) => [c.id, c]));

    // Cuántos ítems quedaron linkeados a un catalogId que ya no existe
    // (producto borrado del catálogo) — no se pueden actualizar.
    let skippedCatalogGone = 0;

    const diffs = linked.flatMap((it) => {
      const cat = catById.get(it.catalogId!);
      if (!cat) {
        skippedCatalogGone++;
        return [];
      }
      // Precio a cliente del catálogo: lista × (1 − dcto), igual que como el
      // propio catálogo muestra el precio (el descuento de la web vive en
      // discountPercent). Bajamos lista + descuento tal cual, así la columna
      // DCTO de la cotización refleja el descuento de la web.
      const catDiscount = cat.discountPercent ?? 0;
      const catClient = Math.round(cat.listPrice * (1 - catDiscount));
      return [
        {
          itemId: it.id,
          name: it.name,
          room: it.room,
          catalogName: cat.name,
          current: {
            realCostBlarq: it.realCostBlarq,
            clientPrice: it.clientPrice,
            listPrice: it.listPrice,
            imageUrl: it.imageUrl,
            referenceLink: it.referenceLink,
          },
          catalog: {
            realCostBlarq: cat.realCostBlarq,
            clientPrice: catClient,
            listPrice: cat.listPrice,
            discountPercent: catDiscount,
            imageUrl: cat.imageUrl,
            referenceLink: cat.referenceLink,
          },
        },
      ];
    });

    return NextResponse.json({ diffs, skippedNoCatalog, skippedCatalogGone });
  } catch (error) {
    console.error("Error armando diff con el catálogo:", error);
    return NextResponse.json(
      { error: "Error al comparar con el catálogo" },
      { status: 500 }
    );
  }
}

// Patch que aplica el modal: cada campo es opcional (solo lo que MJ marcó).
interface ApplyPatch {
  itemId: string;
  listPrice?: number;
  discountPercent?: number;
  realCostBlarq?: number;
  imageUrl?: string;
  referenceLink?: string | null;
}

/**
 * POST /api/presupuestos/{id}/artefactos/actualizar-catalogo
 *   Aplica los valores del catálogo elegidos en el modal. A propósito NO pasa
 *   por el PUT por-ítem: ese tiene la heurística de "despegar" (priceOverridden)
 *   que marcaría la línea como editada a mano. Bajar del catálogo es lo
 *   contrario, así que acá NO se toca priceOverridden — el botón solo copia los
 *   valores elegidos y nada más. Si llega listPrice/discountPercent, se recalcula
 *   el clientPrice (misma convención que el editor).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const body = await request.json();
    const patches: ApplyPatch[] = Array.isArray(body?.patches)
      ? body.patches
      : [];

    const updated = [];
    for (const p of patches) {
      // Solo ítems de ESTE presupuesto (no confiar en el itemId del cliente).
      const prev = await prisma.artefactoItem.findFirst({
        where: { id: p.itemId, budgetVersionId },
        select: { listPrice: true, discountPercent: true, clientPrice: true },
      });
      if (!prev) continue;

      const data: Record<string, unknown> = {};
      if (p.realCostBlarq !== undefined) data.realCostBlarq = p.realCostBlarq;
      if (p.imageUrl !== undefined) data.imageUrl = p.imageUrl;
      if (p.referenceLink !== undefined) data.referenceLink = p.referenceLink;

      // Si cambia el precio de lista o el descuento, recalculamos el precio a
      // cliente (clientPrice = lista × (1 − dcto)), igual que el editor.
      const priceTouched =
        p.listPrice !== undefined || p.discountPercent !== undefined;
      if (priceTouched) {
        const listPrice = p.listPrice ?? prev.listPrice;
        const discountPercent = p.discountPercent ?? prev.discountPercent ?? 0;
        data.listPrice = listPrice;
        data.discountPercent = discountPercent;
        data.clientPrice = listPrice * (1 - discountPercent);
      }

      if (Object.keys(data).length === 0) continue;

      const item = await prisma.artefactoItem.update({
        where: { id: p.itemId },
        data,
        select: {
          id: true,
          listPrice: true,
          discountPercent: true,
          clientPrice: true,
          realCostBlarq: true,
          imageUrl: true,
          referenceLink: true,
        },
      });
      updated.push(item);
    }

    return NextResponse.json({ updated });
  } catch (error) {
    console.error("Error aplicando valores del catálogo:", error);
    return NextResponse.json(
      { error: "Error al aplicar los valores del catálogo" },
      { status: 500 }
    );
  }
}
