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
import { requireSession } from "@/lib/apiAuth";

// Edición manual permitida en borrador Y en enviado: una versión enviada
// queda DESLIGADA del catálogo (el sync no la toca) pero MJ igual puede
// ajustarla a mano sin reconectarla — no hace falta volver a borrador
// (eso sí la reconectaría). aprobado/rechazado quedan cerrados.
async function assertBorrador(itemId: string) {
  const item = await prisma.obraItem.findUnique({
    where: { id: itemId },
    select: { budgetVersion: { select: { status: true } } },
  });
  if (!item) return { ok: false, status: 404, msg: "Ítem no encontrado" };
  if (!["borrador", "enviado"].includes(item.budgetVersion.status)) {
    return {
      ok: false,
      status: 400,
      msg: "Solo se pueden editar componentes en presupuestos borrador o enviados",
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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
    // No marcamos isCustomized en la partida entera — solo este componente
    // queda blindado (su flag se setea arriba). Los demás componentes de
    // la partida siguen siendo refrescables desde el catálogo.

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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId, compId } = await params;
    const guard = await assertBorrador(itemId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.msg }, { status: guard.status });
    }

    // Si el componente venía del catálogo (originComponentId != null),
    // dejamos un registro de "descartado intencionalmente" para que el
    // sync masivo no lo recree. Sin esto, el próximo sync con el catálogo
    // volvería a traer ese componente porque sigue ahí en el catálogo.
    const existing = await prisma.obraItemComponent.findUnique({
      where: { id: compId },
      select: { originComponentId: true },
    });

    await prisma.obraItemComponent.delete({ where: { id: compId } });

    if (existing?.originComponentId) {
      await prisma.obraItemDiscardedCatalogComponent.upsert({
        where: {
          obraItemId_partidaComponentId: {
            obraItemId: itemId,
            partidaComponentId: existing.originComponentId,
          },
        },
        create: {
          obraItemId: itemId,
          partidaComponentId: existing.originComponentId,
        },
        update: {},
      });
    }

    await recalcObraItemFromComponents(itemId);
    // No marcamos isCustomized en la partida entera — el descarte queda
    // registrado por componente. La partida sigue siendo refrescable.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error eliminando componente:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
