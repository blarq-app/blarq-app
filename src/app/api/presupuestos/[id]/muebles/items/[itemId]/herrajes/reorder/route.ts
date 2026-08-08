/**
 * Reordenar las LÍNEAS DE HERRAJE de una partida (pendiente 140).
 *
 * PATCH /api/presupuestos/{id}/muebles/items/{itemId}/herrajes/reorder
 *   Body: { orderedIds: string[] }  (TODAS las líneas de la partida, en el
 *   orden NUEVO — el editor manda la lista completa aunque el arrastre haya
 *   ocurrido dentro de un solo sector)
 *
 * Renumera en una transacción: cada línea recibe sortOrder = posición. Calcado
 * de chapters/reorder e items/reorder.
 *
 * NO recalcula la partida a propósito: el costo es la suma de costo × cantidad
 * de las líneas y esa suma no depende del orden. Llamar a
 * recomputeAndPersistHerrajeItem acá sería trabajo de más sin efecto.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const { orderedIds } = (await request.json()) as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds debe ser un array no vacío" },
        { status: 400 },
      );
    }

    // Solo se reordena lo que pertenece a esta partida.
    const propias = await prisma.muebleHerraje.findMany({
      where: { itemId, id: { in: orderedIds } },
      select: { id: true },
    });
    const validos = new Set(propias.map((h) => h.id));

    const result: { id: string; sortOrder: number }[] = [];
    const ops = orderedIds
      .filter((id) => validos.has(id))
      .map((herrajeId, i) => {
        result.push({ id: herrajeId, sortOrder: i });
        return prisma.muebleHerraje.update({
          where: { id: herrajeId },
          data: { sortOrder: i },
        });
      });

    await prisma.$transaction(ops);
    return NextResponse.json({ herrajes: result });
  } catch (error) {
    console.error("Error reordenando herrajes de la partida:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
