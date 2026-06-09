/**
 * CRUD por id de un item del catálogo de artefactos.
 *
 * PUT    /api/catalogo/artefactos/{id} — actualiza campos.
 * DELETE /api/catalogo/artefactos/{id} — borra del catálogo (no afecta
 *        items ya copiados a presupuestos).
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
        supplier: data.supplier,
        referenceLink: data.referenceLink,
        imageUrl: data.imageUrl,
        listPrice: data.listPrice,
        discountPercent: data.discountPercent,
        clientPrice: data.clientPrice,
        realCostBlarq: data.realCostBlarq,
        isStandard: data.isStandard,
        ...(updateLastCheck && { lastPriceCheck: new Date() }),
      },
    });
    return NextResponse.json(item);
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
