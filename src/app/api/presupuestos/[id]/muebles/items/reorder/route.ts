/**
 * Reordenar los ITEMS (partidas) dentro de un capítulo de muebles.
 *
 * PATCH /api/presupuestos/{id}/muebles/items/reorder
 *   Body: { chapterId: string, orderedIds: string[] }  (ids en el orden NUEVO)
 *
 * Renumera en una transacción: cada item recibe sortOrder = posición e
 * itemNumber = "{chapterNumber}.{posición+1}". Devuelve los items con su
 * numeración nueva. No toca costos ni cálculos.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { chapterId, orderedIds } = (await request.json()) as {
      chapterId: string;
      orderedIds: string[];
    };
    if (!chapterId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "chapterId y orderedIds son obligatorios" },
        { status: 400 },
      );
    }

    const chapter = await prisma.muebleChapter.findUnique({
      where: { id: chapterId },
      select: { chapterNumber: true },
    });
    if (!chapter) {
      return NextResponse.json(
        { error: "Capítulo no encontrado" },
        { status: 404 },
      );
    }

    const result: { id: string; itemNumber: string; sortOrder: number }[] = [];
    const ops = orderedIds.map((itemId, i) => {
      const itemNumber = `${chapter.chapterNumber}.${i + 1}`;
      result.push({ id: itemId, itemNumber, sortOrder: i });
      return prisma.muebleItem.update({
        where: { id: itemId },
        data: { itemNumber, sortOrder: i },
      });
    });

    await prisma.$transaction(ops);
    return NextResponse.json({ items: result });
  } catch (error) {
    console.error("Error reordenando items de muebles:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
