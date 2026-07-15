import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Quitar un maestro de la obra. Guarda dos redes de seguridad:
//   - No se puede quitar si tiene Estados de Pago (hay historial de pagos).
//   - Al quitarlo, sus partidas asignadas vuelven a "sin asignar" (maestroId
//     null), no se borran.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; maestroId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: projectId, maestroId } = await params;

    const epCount = await prisma.estadoPago.count({
      where: { projectId, maestroId },
    });
    if (epCount > 0) {
      return NextResponse.json(
        {
          error:
            "Este maestro ya tiene estados de pago en la obra. Eliminá primero sus EPs si querés sacarlo.",
        },
        { status: 409 }
      );
    }

    // Devolver sus partidas a "sin asignar" y desvincularlo de la obra.
    await prisma.$transaction([
      prisma.obraItem.updateMany({
        where: { maestroId, budgetVersion: { projectId } },
        data: { maestroId: null },
      }),
      prisma.projectMaestro.deleteMany({
        where: { projectId, maestroId },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error quitando maestro de la obra:", error);
    return NextResponse.json(
      { error: "Error al quitar el maestro de la obra" },
      { status: 500 }
    );
  }
}
