/**
 * Reordenar los COMPONENTES (MuebleDetail) de una partida de muebles
 * (pendiente 140 — arrastrar arriba/abajo CUERPO INTERIOR, FRENTES, ZÓCALO…).
 *
 * PATCH /api/presupuestos/{id}/muebles/details/reorder
 *   Body: { itemId: string, orderedIds: string[] }  (ids en el orden NUEVO)
 *
 * Renumera en una transacción: cada componente recibe sortOrder = posición.
 * Calcado de chapters/reorder e items/reorder. No toca nombres ni cálculos: el
 * componente es puro texto descriptivo, no entra en ningún total.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId, orderedIds } = (await request.json()) as {
      itemId: string;
      orderedIds: string[];
    };
    if (!itemId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "itemId y orderedIds son obligatorios" },
        { status: 400 },
      );
    }

    // Solo se reordena lo que realmente pertenece a esta partida: si llega un
    // id de otra, se ignora en vez de moverlo por error.
    const propios = await prisma.muebleDetail.findMany({
      where: { itemId, id: { in: orderedIds } },
      select: { id: true },
    });
    const validos = new Set(propios.map((d) => d.id));

    const result: { id: string; sortOrder: number }[] = [];
    const ops = orderedIds
      .filter((id) => validos.has(id))
      .map((detailId, i) => {
        result.push({ id: detailId, sortOrder: i });
        return prisma.muebleDetail.update({
          where: { id: detailId },
          data: { sortOrder: i },
        });
      });

    await prisma.$transaction(ops);
    return NextResponse.json({ details: result });
  } catch (error) {
    console.error("Error reordenando componentes de muebles:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
