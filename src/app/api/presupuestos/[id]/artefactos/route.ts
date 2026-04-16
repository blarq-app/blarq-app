import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    const allItems = await prisma.artefactoItem.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSortOrder = allItems.length > 0 ? allItems[0].sortOrder + 1 : 0;

    const listPrice = data.listPrice || 0;
    const discountPct = data.discountPercent || 0;
    const quantity = data.quantity || 1;
    const clientPrice = listPrice * (1 - discountPct / 100) * quantity;

    const item = await prisma.artefactoItem.create({
      data: {
        budgetVersionId,
        room: data.room || "otro",
        subcategory: data.subcategory || "sanitario",
        name: data.name,
        detail: data.detail || null,
        brand: data.brand || null,
        quantity,
        listPrice,
        discountPercent: discountPct,
        clientPrice,
        realCostBlarq: data.realCostBlarq || null,
        referenceLink: data.referenceLink || null,
        sortOrder: nextSortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating artefacto item:", error);
    return NextResponse.json(
      { error: "Error al crear artefacto" },
      { status: 500 }
    );
  }
}
