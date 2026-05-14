/**
 * Componentes de un ObraItem (snapshot por proyecto).
 *
 * GET: lista componentes del ítem.
 * POST: agrega un componente nuevo. Marca isCustomized=true en el componente.
 *       Recalcula los totales del ObraItem desde sus componentes.
 *
 * Solo se permite editar presupuestos en status="borrador" — los demás
 * están congelados.
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const components = await prisma.obraItemComponent.findMany({
      where: { obraItemId: itemId },
      include: { material: true },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(components);
  } catch (error) {
    console.error("Error listando componentes:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const guard = await assertBorrador(itemId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.msg }, { status: guard.status });
    }

    const data = await request.json();
    const qty = data.quantity ?? 0;
    const cost = data.unitCost ?? 0;

    const component = await prisma.obraItemComponent.create({
      data: {
        obraItemId: itemId,
        type: data.type,
        description: data.description ?? "",
        unit: data.unit ?? "UN",
        quantity: qty,
        unitCost: cost,
        totalCost: data.totalCost ?? qty * cost,
        referenceLink: data.referenceLink ?? null,
        materialId: data.materialId ?? null,
        sortOrder: data.sortOrder ?? 0,
        appliedToComponentId: data.appliedToComponentId ?? null,
        appliedToType: data.appliedToType ?? null,
        // El usuario está creando un componente nuevo a mano — eso es
        // "personalizado" para el sync futuro.
        isCustomized: true,
      },
    });

    await recalcObraItemFromComponents(itemId);
    // Marcamos el ítem como customizado para que un sync masivo posterior
    // no recalcule sus totales agregados desde el catálogo.
    await prisma.obraItem.update({
      where: { id: itemId },
      data: { isCustomized: true },
    });

    return NextResponse.json(component);
  } catch (error) {
    console.error("Error creando componente:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
