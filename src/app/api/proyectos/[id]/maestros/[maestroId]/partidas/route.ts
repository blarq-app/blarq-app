import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { findLatestObraBudget } from "@/lib/ep/snapshot";

// Asignación de partidas a un maestro. Fuente de verdad: ObraItem.maestroId de
// la versión de obra vigente (la misma que usan los EPs). Una partida = un solo
// maestro; tildarla para un maestro se la quita a cualquier otro.

// GET → estado del selector: todas las partidas de la obra, con su asignación
// actual (de este maestro, de otro, o sin asignar).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; maestroId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id: projectId, maestroId } = await params;

  const budget = await findLatestObraBudget(prisma, projectId);
  if (!budget) {
    return NextResponse.json({ budgetVersionId: null, items: [] });
  }

  // Nombres de los maestros que tienen partidas asignadas, para etiquetar las
  // que son "de otro".
  const maestros = await prisma.maestro.findMany({
    where: { obraItems: { some: { budgetVersionId: budget.id } } },
    select: { id: true, name: true },
  });
  const nameById = new Map(maestros.map((m) => [m.id, m.name]));

  const items = budget.obraItems.map((it) => ({
    id: it.id,
    itemNumber: it.itemNumber,
    chapterId: it.chapterId,
    subChapter: it.subChapter,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    sortOrder: it.sortOrder,
    maestroId: it.maestroId,
    // Estado respecto al maestro que estoy editando
    assignedToThis: it.maestroId === maestroId,
    otherMaestroName:
      it.maestroId && it.maestroId !== maestroId
        ? nameById.get(it.maestroId) ?? null
        : null,
  }));

  return NextResponse.json({ budgetVersionId: budget.id, items });
}

// PUT → fija el conjunto COMPLETO de partidas de este maestro. Body:
//   { obraItemIds: string[] }  (las que quedan tildadas para este maestro)
// Reglas:
//   - Tildadas → maestroId = este maestro (se las quita a otros si estaban).
//   - Las que estaban en este maestro y ya no están tildadas → sin asignar.
//   - Las de otros maestros que no se tildaron → intactas.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; maestroId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: projectId, maestroId } = await params;
    const body = await request.json();
    const requested: string[] = Array.isArray(body.obraItemIds)
      ? body.obraItemIds
      : [];

    // El maestro debe estar vinculado a la obra.
    const link = await prisma.projectMaestro.findUnique({
      where: { projectId_maestroId: { projectId, maestroId } },
    });
    if (!link) {
      return NextResponse.json(
        { error: "El maestro no está en esta obra" },
        { status: 400 }
      );
    }

    const budget = await findLatestObraBudget(prisma, projectId);
    if (!budget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra" },
        { status: 400 }
      );
    }

    // Solo se aceptan ids que pertenezcan a la versión vigente (defensa).
    const validIds = new Set(budget.obraItems.map((i) => i.id));
    const assignIds = requested.filter((id) => validIds.has(id));

    await prisma.$transaction([
      // Tildadas → este maestro (roba a quien las tuviera).
      prisma.obraItem.updateMany({
        where: { id: { in: assignIds } },
        data: { maestroId },
      }),
      // Las que eran de este maestro y ya no están tildadas → sin asignar.
      prisma.obraItem.updateMany({
        where: {
          budgetVersionId: budget.id,
          maestroId,
          id: { notIn: assignIds.length > 0 ? assignIds : ["__none__"] },
        },
        data: { maestroId: null },
      }),
    ]);

    const assignedCount = assignIds.length;
    return NextResponse.json({ ok: true, assignedCount });
  } catch (error) {
    console.error("Error asignando partidas al maestro:", error);
    return NextResponse.json(
      { error: "Error al asignar las partidas" },
      { status: 500 }
    );
  }
}
