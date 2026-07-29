/**
 * Lista las cotizaciones de artefactos de OTROS proyectos (y otras
 * versiones del mismo) que se pueden usar como origen para duplicar.
 *
 * GET /api/presupuestos/{id}/artefactos/fuentes
 *   Devuelve todas las BudgetVersion de tipo "artefactos" que tengan al
 *   menos un item, excluyendo la cotización actual. Se usa en el modal
 *   "Traer de otra cotización".
 *
 * Cada fuente trae además el desglose por pestaña (`porSubcategoria`), para
 * que el modal pueda mostrar cuántos artefactos sanitarios / de cocina /
 * de iluminación hay antes de importar, y no ofrecer tildar una vacía.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;

    const budgets = await prisma.budgetVersion.findMany({
      where: {
        type: "artefactos",
        id: { not: budgetVersionId },
      },
      select: {
        id: true,
        version: true,
        status: true,
        date: true,
        project: { select: { id: true, name: true, clientName: true } },
        _count: { select: { artefactoItems: true } },
      },
      orderBy: [{ date: "desc" }],
    });

    // Solo las que tienen items — duplicar una cotización vacía no sirve.
    const conItems = budgets.filter((b) => b._count.artefactoItems > 0);

    // Desglose por pestaña, en una sola consulta para todas las fuentes.
    const porVersion = await prisma.artefactoItem.groupBy({
      by: ["budgetVersionId", "subcategory"],
      where: { budgetVersionId: { in: conItems.map((b) => b.id) } },
      _count: { _all: true },
    });

    // Un item puede tener la subcategoría vacía o algo fuera de las tres
    // pestañas; el editor lo muestra bajo "sanitario", así que acá lo
    // contamos igual — el número de la casilla tiene que coincidir con lo
    // que después trae el importador.
    const SUBCATEGORIAS_VALIDAS = ["sanitario", "cocina", "iluminacion"];
    const desglose = new Map<string, Record<string, number>>();
    for (const fila of porVersion) {
      const key =
        fila.subcategory && SUBCATEGORIAS_VALIDAS.includes(fila.subcategory)
          ? fila.subcategory
          : "sanitario";
      const actual = desglose.get(fila.budgetVersionId) ?? {};
      actual[key] = (actual[key] ?? 0) + fila._count._all;
      desglose.set(fila.budgetVersionId, actual);
    }

    const fuentes = conItems.map((b) => ({
      id: b.id,
      version: b.version,
      status: b.status,
      date: b.date,
      projectId: b.project.id,
      projectName: b.project.name,
      clientName: b.project.clientName,
      itemCount: b._count.artefactoItems,
      porSubcategoria: desglose.get(b.id) ?? {},
    }));

    return NextResponse.json(fuentes);
  } catch (error) {
    console.error("Error listando fuentes de artefactos:", error);
    return NextResponse.json(
      { error: "Error al listar cotizaciones disponibles" },
      { status: 500 }
    );
  }
}
