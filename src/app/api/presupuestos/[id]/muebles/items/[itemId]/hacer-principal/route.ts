import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

/**
 * "Hacer principal" una alternativa para el cliente (pendiente 177).
 *
 * POST /api/presupuestos/{id}/muebles/items/{itemId}/hacer-principal
 *
 * Cuando el cliente elige la alternativa, se INTERCAMBIAN los papeles: la
 * alternativa pasa a ser la partida base (suma en los totales, sale numerada)
 * y la base vieja queda colgada como alternativa — no se borra, porque el
 * cliente ya la vio y MJ tendría que retipearla si se arrepiente. Las demás
 * alternativas de la base vieja se recuelgan de la nueva base.
 *
 * Solo se mueven los punteros y la posición (sortOrder / itemNumber): nada de
 * precios, sub-líneas ni cotizaciones de proveedor cambia de dueño.
 *
 * Devuelve las partidas del capítulo completas (con sub-líneas, cotizaciones y
 * herrajes) para que el editor reemplace su estado sin recargar.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId, itemId } = await params;
    const alt = await prisma.muebleItem.findUnique({
      where: { id: itemId },
      include: { alternativeOf: true },
    });
    if (!alt || alt.budgetVersionId !== budgetVersionId) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    if (!alt.alternativeOf) {
      return NextResponse.json(
        { error: "Esta partida ya es la principal" },
        { status: 400 },
      );
    }
    const base = alt.alternativeOf;

    await prisma.$transaction([
      // 1) La alternativa sube a base y toma la posición de la base vieja.
      prisma.muebleItem.update({
        where: { id: alt.id },
        data: {
          alternativeOfId: null,
          sortOrder: base.sortOrder,
          itemNumber: base.itemNumber,
        },
      }),
      // 2) Las hermanas se recuelgan de la nueva base.
      prisma.muebleItem.updateMany({
        where: { alternativeOfId: base.id, id: { not: alt.id } },
        data: { alternativeOfId: alt.id },
      }),
      // 3) La base vieja queda como alternativa de la nueva.
      prisma.muebleItem.update({
        where: { id: base.id },
        data: { alternativeOfId: alt.id },
      }),
    ]);

    const items = await prisma.muebleItem.findMany({
      where: { chapterId: base.chapterId },
      orderBy: { sortOrder: "asc" },
      include: {
        details: { orderBy: { sortOrder: "asc" } },
        quotes: { orderBy: { sortOrder: "asc" } },
        herrajes: { orderBy: { sortOrder: "asc" } },
      },
    });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error al hacer principal la alternativa:", error);
    return NextResponse.json(
      { error: "Error al hacer principal" },
      { status: 500 },
    );
  }
}
