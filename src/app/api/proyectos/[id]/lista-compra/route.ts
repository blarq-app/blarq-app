import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// GET: obtener items de lista de compra del proyecto
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const items = await prisma.shoppingItem.findMany({
    where: { projectId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(items);
}

// POST: agregar item manual
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const data = await req.json();

  const last = await prisma.shoppingItem.findFirst({
    where: { projectId: id },
    orderBy: { sortOrder: "desc" },
  });

  const item = await prisma.shoppingItem.create({
    data: {
      projectId: id,
      name: data.name,
      unit: data.unit || "UN",
      qtyNeeded: data.qtyNeeded || 0,
      qtyBought: data.qtyBought || 0,
      notes: data.notes || null,
      materialId: data.materialId || null,
      manualAdd: true,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json(item);
}
