/**
 * Lista las cotizaciones de artefactos de OTROS proyectos (y otras
 * versiones del mismo) que se pueden usar como origen para duplicar.
 *
 * GET /api/presupuestos/{id}/artefactos/fuentes
 *   Devuelve todas las BudgetVersion de tipo "artefactos" que tengan al
 *   menos un item, excluyendo la cotización actual. Se usa en el modal
 *   "Traer de otra cotización".
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const fuentes = budgets
      .filter((b) => b._count.artefactoItems > 0)
      .map((b) => ({
        id: b.id,
        version: b.version,
        status: b.status,
        date: b.date,
        projectId: b.project.id,
        projectName: b.project.name,
        clientName: b.project.clientName,
        itemCount: b._count.artefactoItems,
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
