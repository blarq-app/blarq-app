import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const data = await request.json();

    const cost = data.costDistributor ?? 0;
    const utility = data.utilityPercentage ?? 0;
    const net = cost * (1 + utility);
    const iva = net * 1.19;

    const updated = await prisma.muebleItem.update({
      where: { id: itemId },
      data: {
        itemNumber: data.itemNumber,
        name: data.name,
        descriptionGeneral: data.descriptionGeneral ?? null,
        quantity: data.quantity ?? 1,
        supplier: data.supplier ?? null,
        costDistributor: cost,
        utilityPercentage: utility,
        clientPriceNet: net,
        clientPriceIva: iva,
        sortOrder: data.sortOrder,
      },
    });

    // Mantener la quote activa sincronizada con los valores del item
    // (si el usuario edita supplier/cost/utility desde el panel principal,
    // se refleja también en la cotización activa).
    await prisma.muebleQuote.updateMany({
      where: { itemId, isSelected: true },
      data: {
        supplier: updated.supplier,
        costDistributor: updated.costDistributor,
        utilityPercentage: updated.utilityPercentage,
        clientPriceNet: updated.clientPriceNet,
        clientPriceIva: updated.clientPriceIva,
      },
    });

    return NextResponse.json(updated);
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
