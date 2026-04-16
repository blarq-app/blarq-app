import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const data = await request.json();

    const costDistributor = data.costDistributor || 0;
    const utilityPct = data.utilityPercentage || 0;
    const clientPrice = costDistributor * (1 + utilityPct / 100);
    const clientPriceIva = clientPrice * 1.19;

    const item = await prisma.muebleItem.update({
      where: { id: itemId },
      data: {
        subcategory: data.subcategory,
        description: data.description,
        supplier: data.supplier,
        costDistributor,
        utilityPercentage: utilityPct,
        clientPrice,
        clientPriceIva,
        sortOrder: data.sortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating mueble item:", error);
    return NextResponse.json(
      { error: "Error al actualizar item" },
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
    await prisma.muebleItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mueble item:", error);
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    );
  }
}
