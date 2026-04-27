import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Crear cotización alternativa para un MuebleItem.
// Siempre se crea con isSelected=false. Para hacerla activa hay que llamar
// al endpoint /quotes/[quoteId]/activate explícitamente.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params;
    const data = await request.json();
    if (!data.itemId) {
      return NextResponse.json({ error: "itemId requerido" }, { status: 400 });
    }

    const existing = await prisma.muebleQuote.findMany({
      where: { itemId: data.itemId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSort = existing.length > 0 ? existing[0].sortOrder + 1 : 0;

    const cost = data.costDistributor ?? 0;
    const utility = data.utilityPercentage ?? 0;
    const net = cost * (1 + utility);
    const iva = net * 1.19;

    const quote = await prisma.muebleQuote.create({
      data: {
        itemId: data.itemId,
        supplier: data.supplier ?? null,
        costDistributor: cost,
        utilityPercentage: utility,
        clientPriceNet: net,
        clientPriceIva: iva,
        notes: data.notes ?? null,
        isSelected: false,
        sortOrder: nextSort,
      },
    });
    return NextResponse.json(quote);
  } catch (error) {
    console.error("Error creating mueble quote:", error);
    return NextResponse.json(
      { error: "Error al crear cotización" },
      { status: 500 }
    );
  }
}
