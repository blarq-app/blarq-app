import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    const allItems = await prisma.muebleItem.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSortOrder = allItems.length > 0 ? allItems[0].sortOrder + 1 : 0;

    const costDistributor = data.costDistributor || 0;
    const utilityPct = data.utilityPercentage || 0;
    const clientPrice = costDistributor * (1 + utilityPct / 100);
    const clientPriceIva = clientPrice * 1.19;

    const item = await prisma.muebleItem.create({
      data: {
        budgetVersionId,
        subcategory: data.subcategory || "mueble",
        description: data.description,
        supplier: data.supplier || null,
        costDistributor,
        utilityPercentage: utilityPct,
        clientPrice,
        clientPriceIva,
        sortOrder: nextSortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating mueble item:", error);
    return NextResponse.json(
      { error: "Error al crear item de mueble" },
      { status: 500 }
    );
  }
}
