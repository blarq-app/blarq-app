import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const { quoteId } = await params;
    const data = await request.json();

    // Patch parcial: solo actualiza los campos que vienen en el body.
    // Si cambia costo o utilidad, recalcula los precios derivados.
    const current = await prisma.muebleQuote.findUnique({
      where: { id: quoteId },
    });
    if (!current) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      );
    }

    const cost =
      data.costDistributor !== undefined
        ? data.costDistributor
        : current.costDistributor;
    const utility =
      data.utilityPercentage !== undefined
        ? data.utilityPercentage
        : current.utilityPercentage;
    const recalcNeeded =
      data.costDistributor !== undefined ||
      data.utilityPercentage !== undefined;
    const net = recalcNeeded ? cost * (1 + utility) : current.clientPriceNet;
    const iva = recalcNeeded ? net * 1.19 : current.clientPriceIva;

    const quote = await prisma.muebleQuote.update({
      where: { id: quoteId },
      data: {
        ...(data.supplier !== undefined ? { supplier: data.supplier } : {}),
        ...(data.costDistributor !== undefined ? { costDistributor: cost } : {}),
        ...(data.utilityPercentage !== undefined
          ? { utilityPercentage: utility }
          : {}),
        ...(recalcNeeded
          ? { clientPriceNet: net, clientPriceIva: iva }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    // Si esta quote es la activa, sincronizamos los valores denormalizados
    // en el MuebleItem padre para que totales y PDF reflejen el cambio.
    if (quote.isSelected) {
      await prisma.muebleItem.update({
        where: { id: quote.itemId },
        data: {
          supplier: quote.supplier,
          costDistributor: quote.costDistributor,
          utilityPercentage: quote.utilityPercentage,
          clientPriceNet: quote.clientPriceNet,
          clientPriceIva: quote.clientPriceIva,
        },
      });
    }

    return NextResponse.json(quote);
  } catch (error) {
    console.error("Error updating mueble quote:", error);
    return NextResponse.json(
      { error: "Error al actualizar cotización" },
      { status: 500 }
    );
  }
}

// No se permite borrar la cotización activa si es la única — primero hay
// que activar otra. Si la activa tiene alternativas y se borra, se promueve
// la siguiente alternativa automáticamente.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
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

    const siblings = await prisma.muebleQuote.findMany({
      where: { itemId: quote.itemId, id: { not: quoteId } },
      orderBy: { sortOrder: "asc" },
    });

    if (quote.isSelected && siblings.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se puede eliminar la única cotización del item. Eliminá el item completo en su lugar.",
        },
        { status: 400 }
      );
    }

    await prisma.muebleQuote.delete({ where: { id: quoteId } });

    // Si era la activa, promover la primera alternativa
    if (quote.isSelected && siblings.length > 0) {
      const next = siblings[0];
      await prisma.muebleQuote.update({
        where: { id: next.id },
        data: { isSelected: true },
      });
      await prisma.muebleItem.update({
        where: { id: quote.itemId },
        data: {
          supplier: next.supplier,
          costDistributor: next.costDistributor,
          utilityPercentage: next.utilityPercentage,
          clientPriceNet: next.clientPriceNet,
          clientPriceIva: next.clientPriceIva,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mueble quote:", error);
    return NextResponse.json(
      { error: "Error al eliminar cotización" },
      { status: 500 }
    );
  }
}
