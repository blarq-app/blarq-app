import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators, findLatestObraBudget } from "@/lib/ep/snapshot";
import { computeSyncDiff } from "@/lib/ep/sync";
import { requireSession } from "@/lib/apiAuth";

// Devuelve el diff entre el EP actual y la versión más nueva del presupuesto
// SIN mutar nada. La UI lo usa para mostrar checkboxes y dejar que el usuario
// elija qué cambios aplicar.
export async function GET(
  request: NextRequest,
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

    // Versión destino: la que MJ elija a mano (?targetVersionId=), validada como
    // obra de este proyecto; si no, la vigente.
    const targetVersionId = request.nextUrl.searchParams.get("targetVersionId");
    const obraBudget = targetVersionId
      ? await prisma.budgetVersion.findFirst({
          where: { id: targetVersionId, projectId: ep.projectId, type: "obra" },
          include: {
            obraChapters: { orderBy: { sortOrder: "asc" } },
            obraItems: { orderBy: { sortOrder: "asc" } },
          },
        })
      : await findLatestObraBudget(prisma, ep.projectId);
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

    // El diff compara por NOMBRE de capítulo (los capítulos son filas propias
    // de cada versión, con ids distintos aunque se llamen igual). Este mapa
    // traduce el chapterId de cada partida a su nombre y posición.
    const capitulo = new Map(
      obraBudget.obraChapters.map((c) => [
        c.id,
        { name: c.name, sortOrder: c.sortOrder },
      ])
    );
    const budgetItemsForDiff = budgetItems.map((it) => ({
      ...it,
      chapterName: it.chapterId ? capitulo.get(it.chapterId)?.name ?? "" : "",
    }));

    const { prevAmountPaidByLineage } = await buildPrevAccumulators(prisma, {
      projectId: ep.projectId,
      maestroId: ep.maestroId,
      beforeNumber: ep.number,
    });

    const diff = computeSyncDiff(
      ep.items,
      budgetItemsForDiff,
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
