import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Upsert de tracking de compra por material.
// Si viene shoppingItemId, actualiza ese.
// Si no, crea uno nuevo con qtyBought/notas.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id: projectId } = await params;
  const data = await req.json();

  if (data.shoppingItemId) {
    const item = await prisma.shoppingItem.update({
      where: { id: data.shoppingItemId },
      data: {
        qtyBought: data.qtyBought ?? 0,
        notes: data.notes ?? null,
      },
    });
    return NextResponse.json(item);
  }

  const item = await prisma.shoppingItem.create({
    data: {
      projectId,
      name: data.name,
      unit: data.unit || "UN",
      qtyNeeded: 0, // el qtyNeeded siempre se computa en vivo desde el presupuesto
      qtyBought: data.qtyBought ?? 0,
      notes: data.notes ?? null,
      materialId: data.materialId || null,
      manualAdd: !!data.manualAdd,
    },
  });
  return NextResponse.json(item);
}
