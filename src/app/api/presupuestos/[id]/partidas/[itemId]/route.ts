import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const data = await request.json();

    const total = (data.quantity || 0) * (data.unitPrice || 0);

    const item = await prisma.obraItem.update({
      where: { id: itemId },
      data: {
        name: data.name,
        descriptionCliente: data.descriptionCliente ?? data.description,
        descriptionMaestro: data.descriptionMaestro,
        unit: data.unit,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        total,
        costMaterial: data.costMaterial,
        costLabor: data.costLabor,
        costSubcontract: data.costSubcontract,
        costMargin: data.costMargin,
        costTools: data.costTools,
        costLoss: data.costLoss,
        sortOrder: data.sortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating obra item:", error);
    return NextResponse.json(
      { error: "Error al actualizar partida" },
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
    await prisma.obraItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting obra item:", error);
    return NextResponse.json(
      { error: "Error al eliminar partida" },
      { status: 500 }
    );
  }
}
