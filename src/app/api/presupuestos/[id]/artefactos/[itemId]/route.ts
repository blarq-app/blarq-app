import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const data = await request.json();

    // Convención: discountPercent es decimal (0..1) y clientPrice es
    // unitario (no incluye qty). El editor manda valores ya calculados.
    // Si no llega clientPrice explícito, lo recalculamos.
    const listPrice = data.listPrice ?? 0;
    const discountPct = data.discountPercent ?? 0;
    const quantity = data.quantity ?? 1;
    const clientPrice =
      data.clientPrice !== undefined && data.clientPrice !== null
        ? data.clientPrice
        : listPrice * (1 - discountPct);

    const item = await prisma.artefactoItem.update({
      where: { id: itemId },
      data: {
        room: data.room,
        subcategory: data.subcategory,
        name: data.name,
        detail: data.detail,
        brand: data.brand,
        quantity,
        listPrice,
        discountPercent: discountPct,
        clientPrice,
        realCostBlarq: data.realCostBlarq ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        catalogId: data.catalogId ?? null,
        sortOrder: data.sortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating artefacto item:", error);
    return NextResponse.json(
      { error: "Error al actualizar artefacto" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    await prisma.artefactoItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting artefacto item:", error);
    return NextResponse.json(
      { error: "Error al eliminar artefacto" },
      { status: 500 }
    );
  }
}
