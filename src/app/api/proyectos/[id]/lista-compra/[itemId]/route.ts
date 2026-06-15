import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { itemId } = await params;
  const data = await req.json();
  const item = await prisma.shoppingItem.update({
    where: { id: itemId },
    data: {
      name: data.name,
      unit: data.unit,
      qtyNeeded: data.qtyNeeded,
      qtyBought: data.qtyBought,
      notes: data.notes,
    },
  });
  return NextResponse.json(item);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { itemId } = await params;
  await prisma.shoppingItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
