import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Actualizar presupuesto (observaciones, GG%, utilidad%, estado)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    const budget = await prisma.budgetVersion.update({
      where: { id },
      data: {
        observations: data.observations,
        ggPercentage: data.ggPercentage,
        utilityPercentage: data.utilityPercentage,
        status: data.status,
      },
    });

    return NextResponse.json(budget);
  } catch (error) {
    console.error("Error updating budget:", error);
    return NextResponse.json(
      { error: "Error al actualizar presupuesto" },
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
    await prisma.budgetVersion.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting budget:", error);
    return NextResponse.json(
      { error: "Error al eliminar presupuesto" },
      { status: 500 }
    );
  }
}
