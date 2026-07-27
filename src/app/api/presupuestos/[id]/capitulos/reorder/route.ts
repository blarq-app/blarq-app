/**
 * Reordenar los CAPÍTULOS de obra de una versión (arrastrar arriba/abajo).
 *
 * PATCH /api/presupuestos/{id}/capitulos/reorder
 *   Body: { orderedIds: string[] }  (ids de capítulo en el orden NUEVO)
 *
 * El servidor asigna sortOrder = posición, en una transacción. La numeración
 * que ve el cliente (1, 2, 3…) NO se guarda: se deriva de la posición entre
 * los capítulos con partidas al momento de mostrar (ver lib/presupuesto/
 * chapters.ts). Por eso acá no hay nada que renumerar, a diferencia de muebles
 * — que sí guarda chapterNumber e itemNumber.
 *
 * No toca nombres, partidas, costos ni cálculos.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const { orderedIds } = (await request.json()) as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds debe ser un array no vacío" },
        { status: 400 }
      );
    }

    // Solo capítulos de ESTA versión: un id ajeno se ignora.
    const propios = await prisma.obraChapter.findMany({
      where: { budgetVersionId, id: { in: orderedIds } },
      select: { id: true },
    });
    const validos = new Set(propios.map((c) => c.id));

    await prisma.$transaction(
      orderedIds
        .filter((id) => validos.has(id))
        .map((id, idx) =>
          prisma.obraChapter.update({
            where: { id },
            data: { sortOrder: idx },
          })
        )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordenando capítulos de obra:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
