import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { esSinManoDeObra } from "@/lib/ep/hideNoLabor";
import { requireSession } from "@/lib/apiAuth";

// Lo que necesita la ventana "PDF maestro" para armarse: los maestros de la
// obra (a quién se le manda) y las partidas de ESTA versión con su asignación
// actual (para pre-tildar las suyas). Se lee al abrir la ventana, no al cargar
// la página: MJ abre el PDF después de editar partidas y si los datos vinieran
// del render de la página estarían viejos.
//
// SOLO LECTURA: la selección que MJ haga con esto NO se guarda en ningún lado
// — sirve para armar el documento y nada más (ver DescargasMaestro.tsx).
//
// GET /api/presupuestos/:id/maestro/partidas
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;

  const budget = await prisma.budgetVersion.findUnique({
    where: { id },
    include: {
      project: {
        include: {
          maestro: { select: { id: true, name: true } },
          projectMaestros: {
            include: { maestro: { select: { id: true, name: true } } },
          },
        },
      },
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: {
        orderBy: { sortOrder: "asc" },
        include: { maestro: { select: { id: true, name: true } } },
      },
    },
  });

  if (!budget) {
    return NextResponse.json(
      { error: "Presupuesto no encontrado" },
      { status: 404 }
    );
  }
  if (budget.type !== "obra") {
    return NextResponse.json(
      { error: "Solo disponible para presupuestos de obra (mano de obra)" },
      { status: 400 }
    );
  }

  // Maestros que se pueden elegir: los vinculados a la obra (ProjectMaestro),
  // más el "principal" legacy del proyecto y cualquiera que ya tenga partidas
  // en esta versión aunque no esté vinculado (data vieja). Sin duplicados, en
  // orden alfabético para que MJ lo encuentre rápido.
  const maestros = new Map<string, string>();
  for (const pm of budget.project.projectMaestros) {
    maestros.set(pm.maestro.id, pm.maestro.name);
  }
  if (budget.project.maestro) {
    maestros.set(budget.project.maestro.id, budget.project.maestro.name);
  }
  for (const it of budget.obraItems) {
    if (it.maestro) maestros.set(it.maestro.id, it.maestro.name);
  }

  const items = budget.obraItems.map((it) => ({
    id: it.id,
    chapterId: it.chapterId,
    subChapter: it.subChapter,
    sortOrder: it.sortOrder,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    costLabor: it.costLabor,
    maestroId: it.maestroId,
    // Mismo criterio que el documento y el EP: MO en 0 con costo por otro lado
    // (material / subcontrato) = no es trabajo del maestro. En la ventana se
    // muestran apagadas y sin casilla, para que MJ vea qué queda afuera.
    sinManoDeObra: esSinManoDeObra(it.costLabor ?? 0, it),
  }));

  return NextResponse.json({
    project: { name: budget.project.name },
    budget: { version: budget.version, status: budget.status },
    maestros: [...maestros.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    chapters: budget.obraChapters.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
    })),
    items,
  });
}
