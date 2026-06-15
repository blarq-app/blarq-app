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
import {
  recalcObraItemFromComponents,
  seedObraItemComponentsFromLumps,
} from "@/lib/catalog/recalcObraItem";
import { requireSession } from "@/lib/apiAuth";

// Edición manual permitida en borrador Y en enviado (la enviada está
// deslinkada del catálogo pero sigue editable a mano). Ver nota en
// componentes/[compId]/route.ts. aprobado/rechazado cerrados.
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const guard = await assertBorrador(itemId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.msg }, { status: guard.status });
    }

    const data = await request.json();
    const qty = data.quantity ?? 0;
    const cost = data.unitCost ?? 0;

    // Seguro anti-borrado: si la partida todavía estaba "en bruto" (montos
    // globales sin detalle), primero sembramos esos montos como líneas
    // equivalentes para que al detallar no se pierda la mano de obra / margen
    // que MJ había puesto a mano. No mueve el total. Idempotente.
    await seedObraItemComponentsFromLumps(itemId);

    // sortOrder al final de la lista (cuenta ya incluye lo sembrado).
    const count = await prisma.obraItemComponent.count({
      where: { obraItemId: itemId },
    });

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
        sortOrder: data.sortOrder ?? count,
        appliedToComponentId: data.appliedToComponentId ?? null,
        appliedToType: data.appliedToType ?? null,
        // El usuario está creando un componente nuevo a mano — eso es
        // "personalizado" para el sync futuro.
        isCustomized: true,
      },
    });

    await recalcObraItemFromComponents(itemId);
    // No marcamos isCustomized en la partida entera — solo el componente
    // queda blindado. Permite seguir refrescando precios/descripciones de
    // la partida y los demás componentes desde el catálogo.

    return NextResponse.json(component);
  } catch (error) {
    console.error("Error creando componente:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
