import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; compId: string }> }
) {
  try {
    const { compId } = await params;
    const data = await request.json();

    const qty = data.quantity ?? 0;
    const cost = data.unitCost ?? 0;

    const component = await prisma.partidaComponent.update({
      where: { id: compId },
      data: {
        type: data.type,
        description: data.description,
        unit: data.unit,
        quantity: qty,
        unitCost: cost,
        // El front calcula totalCost (con % sobre material/MO/etc.) y lo
        // manda explícito. Si no viene, fallback al cálculo simple.
        totalCost: data.totalCost ?? qty * cost,
        // sortOrder y materialId solo se persisten si vienen explícitos —
        // así el front puede mandar PUT parcial sin pisarlos accidentalmente.
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.materialId !== undefined && { materialId: data.materialId }),
        ...(data.referenceLink !== undefined && { referenceLink: data.referenceLink }),
        ...(data.appliedToComponentId !== undefined && {
          appliedToComponentId: data.appliedToComponentId,
        }),
        ...(data.appliedToType !== undefined && { appliedToType: data.appliedToType }),
      },
      include: { material: true },
    });

    return NextResponse.json(component);
  } catch (error) {
    console.error("Error updating component:", error);
    return NextResponse.json({ error: "Error al actualizar componente" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; compId: string }> }
) {
  try {
    const { compId } = await params;
    await prisma.partidaComponent.delete({ where: { id: compId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting component:", error);
    return NextResponse.json({ error: "Error al eliminar componente" }, { status: 500 });
  }
}
