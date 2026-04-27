import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Crear item bajo un capítulo de muebles. Auto-genera itemNumber tipo
// "{chapter}.{n+1}" según items existentes en el capítulo.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();
    if (!data.chapterId) {
      return NextResponse.json(
        { error: "chapterId requerido" },
        { status: 400 }
      );
    }

    const chapter = await prisma.muebleChapter.findUnique({
      where: { id: data.chapterId },
      include: { items: { orderBy: { sortOrder: "desc" } } },
    });
    if (!chapter) {
      return NextResponse.json(
        { error: "Capítulo no encontrado" },
        { status: 404 }
      );
    }

    const nextSort =
      chapter.items.length > 0 ? chapter.items[0].sortOrder + 1 : 0;
    const nextItemIdx = chapter.items.length + 1;
    const itemNumber = `${chapter.chapterNumber}.${nextItemIdx}`;

    const cost = data.costDistributor ?? 0;
    const utility = data.utilityPercentage ?? 0;
    const net = cost * (1 + utility);
    const iva = net * 1.19;

    const item = await prisma.muebleItem.create({
      data: {
        budgetVersionId,
        chapterId: data.chapterId,
        itemNumber: data.itemNumber ?? itemNumber,
        name: data.name || "NUEVO ITEM",
        descriptionGeneral: data.descriptionGeneral ?? null,
        quantity: data.quantity ?? 1,
        supplier: data.supplier ?? null,
        costDistributor: cost,
        utilityPercentage: utility,
        clientPriceNet: net,
        clientPriceIva: iva,
        sortOrder: nextSort,
      },
    });

    // Crear quote activa inicial reflejando los valores del item.
    // Cualquier alternativa adicional se agrega después con POST /quotes.
    await prisma.muebleQuote.create({
      data: {
        itemId: item.id,
        supplier: item.supplier,
        costDistributor: item.costDistributor,
        utilityPercentage: item.utilityPercentage,
        clientPriceNet: item.clientPriceNet,
        clientPriceIva: item.clientPriceIva,
        isSelected: true,
        sortOrder: 0,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating mueble item:", error);
    return NextResponse.json(
      { error: "Error al crear item" },
      { status: 500 }
    );
  }
}
