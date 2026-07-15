import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators, findLatestObraBudget } from "@/lib/ep/snapshot";
import { computeSyncDiff } from "@/lib/ep/sync";
import { requireSession } from "@/lib/apiAuth";

// Devuelve el diff entre el EP actual y la versión más nueva del presupuesto
// SIN mutar nada. La UI lo usa para mostrar checkboxes y dejar que el usuario
// elija qué cambios aplicar.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: {
        items: true,
        budgetVersion: { select: { id: true, version: true } },
      },
    });
    if (!ep) {
      return NextResponse.json({ error: "EP no encontrado" }, { status: 404 });
    }
    if (ep.status === "cerrado") {
      return NextResponse.json(
        { error: "El EP está cerrado y no puede sincronizarse." },
        { status: 409 }
      );
    }

    const obraBudget = await findLatestObraBudget(prisma, ep.projectId);
    if (!obraBudget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra para sincronizar" },
        { status: 400 }
      );
    }

    // EP de maestro → comparar solo contra sus partidas de la versión vigente.
    const budgetItems = ep.maestroId
      ? obraBudget.obraItems.filter((it) => it.maestroId === ep.maestroId)
      : obraBudget.obraItems;

    const { prevAmountPaidByLineage } = await buildPrevAccumulators(prisma, {
      projectId: ep.projectId,
      maestroId: ep.maestroId,
      beforeNumber: ep.number,
    });

    const diff = computeSyncDiff(
      ep.items,
      budgetItems,
      prevAmountPaidByLineage
    );

    return NextResponse.json({
      currentVersion: ep.budgetVersion
        ? { id: ep.budgetVersion.id, version: ep.budgetVersion.version }
        : null,
      targetVersion: { id: obraBudget.id, version: obraBudget.version },
      ...diff,
    });
  } catch (error) {
    console.error("Error sync preview EP:", error);
    return NextResponse.json(
      { error: "Error al previsualizar sincronización" },
      { status: 500 }
    );
  }
}
