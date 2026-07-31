/**
 * CRUD por id de un item del catálogo de artefactos.
 *
 * PUT    /api/catalogo/artefactos/{id} — actualiza campos.
 * DELETE /api/catalogo/artefactos/{id} — borra del catálogo (no afecta
 *        items ya copiados a presupuestos).
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { propagateCatalogToBorradores } from "@/lib/catalog/syncArtefactos";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    // Si llega listPrice nuevo, actualizamos lastPriceCheck también.
    const updateLastCheck =
      data.listPrice !== undefined && data.listPrice !== null;

    const item = await prisma.artefactoCatalog.update({
      where: { id },
      data: {
        name: data.name,
        detail: data.detail,
        brand: data.brand,
        subcategory: data.subcategory,
        tag: data.tag,
        line: data.line,
        finish: data.finish,
        supplier: data.supplier,
        referenceLink: data.referenceLink,
        imageUrl: data.imageUrl,
        listPrice: data.listPrice,
        // El precio a cliente sale de listPrice × (1 − discountPercent); el
        // campo `clientPrice` del catálogo se sacó en 2026-07-31 (nadie lo
        // leía — ver la auditoría de precios de artefactos).
        discountPercent: data.discountPercent,
        realCostBlarq: data.realCostBlarq,
        isStandard: data.isStandard,
        ...(updateLastCheck && { lastPriceCheck: new Date() }),
      },
    });

    // ── Propagación catálogo → cotizaciones en BORRADOR ──────────────────
    //
    // Rediseño precios artefactos 2026-06-18 (ADR del mismo día): el catálogo
    // es el precio MAESTRO. Cuando se edita acá (a mano o aplicando "Revisar
    // precios"), el cambio BAJA a las líneas de cotizaciones que:
    //   - apuntan a este item (catalogId),
    //   - NO fueron editadas a mano en la cotización (priceOverridden=false),
    //   - y están en BORRADOR (las enviadas/aprobadas quedan congeladas,
    //     igual que en obra: el catálogo nunca toca lo que ya vio el cliente).
    //
    // Decisión consciente de MJ y DISTINTA a la regla de obra (donde el
    // catálogo es opt-in y no propaga solo). Para artefactos el flujo es como
    // ella arma el presupuesto: el maestro manda sobre los borradores.
    //
    // La lógica vive en lib (testeable sin servidor). Ver syncArtefactos.ts.
    const lineasActualizadas = await propagateCatalogToBorradores(id, {
      name: item.name,
      detail: item.detail,
      brand: item.brand,
      listPrice: item.listPrice,
      discountPercent: item.discountPercent,
      referenceLink: item.referenceLink,
      imageUrl: item.imageUrl,
    });

    return NextResponse.json({ ...item, lineasActualizadas });
  } catch (error) {
    console.error("Error updating catalog artefacto:", error);
    return NextResponse.json(
      { error: "Error al actualizar item del catálogo" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    await prisma.artefactoCatalog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting catalog artefacto:", error);
    return NextResponse.json(
      { error: "Error al borrar item del catálogo" },
      { status: 500 }
    );
  }
}
