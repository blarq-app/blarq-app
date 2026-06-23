/**
 * Reordenar los CAPÍTULOS de muebles de un presupuesto (arrastrar arriba/abajo).
 *
 * PATCH /api/presupuestos/{id}/muebles/chapters/reorder
 *   Body: { orderedIds: string[] }  (ids de capítulo en el orden NUEVO)
 *
 * El servidor renumera solo, en una transacción:
 *   - cada capítulo recibe sortOrder = posición y chapterNumber = posición+1.
 *   - los items de cada capítulo se renumeran con el prefijo nuevo del capítulo
 *     (itemNumber = "{chapterNumber}.{posición del item}"), respetando su orden.
 * Devuelve los capítulos con su numeración nueva para que el editor actualice
 * el estado sin recargar. No toca nombres, costos ni cálculos.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const { orderedIds } = (await request.json()) as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds debe ser un array no vacío" },
        { status: 400 },
      );
    }

    // Items de cada capítulo (para renumerar el prefijo), ordenados.
    const chapters = await prisma.muebleChapter.findMany({
      where: { budgetVersionId, id: { in: orderedIds } },
      include: {
        items: { orderBy: { sortOrder: "asc" }, select: { id: true } },
      },
    });
    const byId = new Map(chapters.map((c) => [c.id, c]));

    const ops: ReturnType<typeof prisma.muebleChapter.update>[] = [];
    const result: {
      id: string;
      chapterNumber: number;
      sortOrder: number;
      items: { id: string; itemNumber: string; sortOrder: number }[];
    }[] = [];

    orderedIds.forEach((chapterId, idx) => {
      const ch = byId.get(chapterId);
      if (!ch) return;
      const chapterNumber = idx + 1;
      ops.push(
        prisma.muebleChapter.update({
          where: { id: chapterId },
          data: { sortOrder: idx, chapterNumber },
        }),
      );
      const items = ch.items.map((it, i) => {
        const itemNumber = `${chapterNumber}.${i + 1}`;
        ops.push(
          prisma.muebleItem.update({
            where: { id: it.id },
            data: { itemNumber, sortOrder: i },
          }) as unknown as ReturnType<typeof prisma.muebleChapter.update>,
        );
        return { id: it.id, itemNumber, sortOrder: i };
      });
      result.push({ id: chapterId, chapterNumber, sortOrder: idx, items });
    });

    await prisma.$transaction(ops);
    return NextResponse.json({ chapters: result });
  } catch (error) {
    console.error("Error reordenando capítulos de muebles:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
