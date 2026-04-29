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

    // Cuando se aprueba un presupuesto de obra, el proyecto pasa a "ejecucion"
    // y se le asigna numeroProyecto si aún no lo tenía (transición cotizacion→ejecucion).
    if (data.status === "aprobado" && budget.type === "obra") {
      const proj = await prisma.project.findUnique({
        where: { id: budget.projectId },
        select: { numeroProyecto: true },
      });

      let numeroProyecto = proj?.numeroProyecto ?? null;
      if (numeroProyecto == null) {
        const max = await prisma.project.aggregate({
          _max: { numeroProyecto: true },
        });
        numeroProyecto = (max._max.numeroProyecto ?? 0) + 1;
      }

      await prisma.project.update({
        where: { id: budget.projectId },
        data: {
          currentVersion: budget.version,
          status: "ejecucion",
          numeroProyecto,
        },
      });
    }

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
