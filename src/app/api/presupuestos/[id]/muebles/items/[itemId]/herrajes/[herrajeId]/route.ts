/**
 * Editar / borrar una línea de herraje de una partida.
 *
 * PUT    .../herrajes/{herrajeId} — edita cantidad y/o sector (lo que MJ ajusta
 *        mirando el plano). No deja cambiar el costo: viene congelado del
 *        catálogo. Recalcula los totales de la partida.
 * DELETE .../herrajes/{herrajeId} — borra la línea y recalcula la partida.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { recomputeAndPersistHerrajeItem } from "@/lib/presupuesto/muebleHerrajes";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; herrajeId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId, herrajeId } = await params;
    const data = await request.json();

    const patch: {
      quantity?: number;
      sector?: string;
      sortOrder?: number;
      name?: string;
    } = {};
    if (data.quantity !== undefined) {
      const q = Number(data.quantity);
      patch.quantity = q > 0 ? q : 1;
    }
    if (typeof data.sector === "string") patch.sector = data.sector.trim();
    // Nombre editable por cotización (no toca el costo, no recalcula nada).
    if (typeof data.name === "string" && data.name.trim()) {
      patch.name = data.name.trim();
    }
    if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder);

    const line = await prisma.muebleHerraje.update({
      where: { id: herrajeId },
      data: patch,
    });
    const item = await recomputeAndPersistHerrajeItem(itemId);

    return NextResponse.json({ line, item });
  } catch (error) {
    console.error("Error editando herraje de la partida:", error);
    return NextResponse.json(
      { error: "Error al editar herraje" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; herrajeId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId, herrajeId } = await params;
    await prisma.muebleHerraje.delete({ where: { id: herrajeId } });
    const item = await recomputeAndPersistHerrajeItem(itemId);
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Error borrando herraje de la partida:", error);
    return NextResponse.json(
      { error: "Error al borrar herraje" },
      { status: 500 },
    );
  }
}
