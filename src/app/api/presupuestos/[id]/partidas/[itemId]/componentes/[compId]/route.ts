/**
 * Editar / borrar un componente individual de un ObraItem.
 *
 * PUT: actualiza campos del componente, marca isCustomized=true, recalcula
 *      totales del ObraItem.
 * DELETE: elimina el componente, recalcula totales del ObraItem.
 *
 * Solo permite editar presupuestos en status="borrador".
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recalcObraItemFromComponents } from "@/lib/catalog/recalcObraItem";

async function assertBorrador(itemId: string) {
  const item = await prisma.obraItem.findUnique({
    where: { id: itemId },
    select: { budgetVersion: { select: { status: true } } },
  });
  if (!item) return { ok: false, status: 404, msg: "Ítem no encontrado" };
  if (item.budgetVersion.status !== "borrador") {
    return {
      ok: false,
      status: 400,
      msg: "Solo se pueden editar componentes en presupuestos borrador",
    };
  }
  return { ok: true as const };
}

export async function PUT(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; itemId: string; compId: string }> }
) {
  try {
    const { itemId, compId } = await params;
    const guard = await assertBorrador(itemId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.msg }, { status: guard.status });
    }

    const data = await request.json();
    const qty = data.quantity ?? 0;
    const cost = data.unitCost ?? 0;

    const component = await prisma.obraItemComponent.update({
      where: { id: compId },
      data: {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.quantity !== undefined && { quantity: qty }),
        ...(data.unitCost !== undefined && { unitCost: cost }),
        ...(data.totalCost !== undefined && {
          totalCost: data.totalCost ?? qty * cost,
        }),
        ...(data.referenceLink !== undefined && {
          referenceLink: data.referenceLink,
        }),
        ...(data.materialId !== undefined && { materialId: data.materialId }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.appliedToComponentId !== undefined && {
          appliedToComponentId: data.appliedToComponentId,
        }),
        ...(data.appliedToType !== undefined && {
          appliedToType: data.appliedToType,
        }),
        // Cualquier edición a mano marca el componente como personalizado
        // para que el sync masivo del material no lo pise.
        isCustomized: true,
      },
    });

    await recalcObraItemFromComponents(itemId);
    await prisma.obraItem.update({
      where: { id: itemId },
      data: { isCustomized: true },
    });

    return NextResponse.json(component);
  } catch (error) {
    console.error("Error actualizando componente:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; itemId: string; compId: string }> }
) {
  try {
    const { itemId, compId } = await params;
    const guard = await assertBorrador(itemId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.msg }, { status: guard.status });
    }

    await prisma.obraItemComponent.delete({ where: { id: compId } });
    await recalcObraItemFromComponents(itemId);
    await prisma.obraItem.update({
      where: { id: itemId },
      data: { isCustomized: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error eliminando componente:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
