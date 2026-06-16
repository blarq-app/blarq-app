import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Crear capítulo de muebles bajo un presupuesto.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    const existing = await prisma.muebleChapter.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSort = existing.length > 0 ? existing[0].sortOrder + 1 : 0;
    const nextNumber = existing.length > 0 ? existing[0].chapterNumber + 1 : 1;

    const chapter = await prisma.muebleChapter.create({
      data: {
        budgetVersionId,
        chapterNumber: data.chapterNumber ?? nextNumber,
        name: data.name || "NUEVO CAPITULO",
        sortOrder: nextSort,
      },
    });
    return NextResponse.json(chapter);
  } catch (error) {
    console.error("Error creating muebles chapter:", error);
    return NextResponse.json(
      { error: "Error al crear capítulo" },
      { status: 500 }
    );
  }
}
