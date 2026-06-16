import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Promueve una cotización a "activa" para su MuebleItem.
// - Marca isSelected=true en esta quote
// - Marca isSelected=false en todas las otras quotes del mismo item
// - Copia los valores de esta quote al MuebleItem padre (denormalización)
//   para que el PDF y los totales del presupuesto reflejen el cambio.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { quoteId } = await params;

    const quote = await prisma.muebleQuote.findUnique({
      where: { id: quoteId },
    });
    if (!quote) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      );
    }

    await prisma.$transaction([
      prisma.muebleQuote.updateMany({
        where: { itemId: quote.itemId, id: { not: quoteId } },
        data: { isSelected: false },
      }),
      prisma.muebleQuote.update({
        where: { id: quoteId },
        data: { isSelected: true },
      }),
      prisma.muebleItem.update({
        where: { id: quote.itemId },
        data: {
          supplier: quote.supplier,
          costDistributor: quote.costDistributor,
          utilityPercentage: quote.utilityPercentage,
          clientPriceNet: quote.clientPriceNet,
          clientPriceIva: quote.clientPriceIva,
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error activating mueble quote:", error);
    return NextResponse.json(
      { error: "Error al activar cotización" },
      { status: 500 }
    );
  }
}
