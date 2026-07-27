/**
 * Crear un capítulo de obra bajo una versión de presupuesto.
 *
 * POST /api/presupuestos/{id}/capitulos
 *   Body: { name: string }
 *
 * El capítulo nuevo se agrega al final. MJ lo reordena arrastrando.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();
    const name = String(data?.name ?? "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "El capítulo necesita un nombre" },
        { status: 400 }
      );
    }

    const ultimo = await prisma.obraChapter.findFirst({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const chapter = await prisma.obraChapter.create({
      data: {
        budgetVersionId,
        name,
        sortOrder: ultimo ? ultimo.sortOrder + 1 : 0,
      },
    });
    return NextResponse.json(chapter);
  } catch (error) {
    console.error("Error creando capítulo de obra:", error);
    return NextResponse.json(
      { error: "Error al crear el capítulo" },
      { status: 500 }
    );
  }
}
