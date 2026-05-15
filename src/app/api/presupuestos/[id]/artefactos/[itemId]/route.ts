import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: budgetVersionId, itemId } = await params;
    const data = await request.json();

    // Convención: discountPercent es decimal (0..1) y clientPrice es
    // unitario (no incluye qty). El editor manda valores ya calculados.
    // Si no llega clientPrice explícito, lo recalculamos.
    const listPrice = data.listPrice ?? 0;
    const discountPct = data.discountPercent ?? 0;
    const quantity = data.quantity ?? 1;
    const clientPrice =
      data.clientPrice !== undefined && data.clientPrice !== null
        ? data.clientPrice
        : listPrice * (1 - discountPct);

    const item = await prisma.artefactoItem.update({
      where: { id: itemId },
      data: {
        room: data.room,
        subcategory: data.subcategory,
        name: data.name,
        detail: data.detail,
        brand: data.brand,
        quantity,
        listPrice,
        discountPercent: discountPct,
        clientPrice,
        realCostBlarq: data.realCostBlarq ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        catalogId: data.catalogId ?? null,
        sortOrder: data.sortOrder,
      },
    });

    // ── Sincronización entre instancias del mismo catalogId ─────────────
    //
    // Si el item pertenece al catálogo BLARQ (tiene catalogId), propagar
    // los campos "del producto" (name, detail, brand, listPrice,
    // discountPercent, clientPrice, referenceLink, imageUrl) a:
    //   1. Las otras copias del mismo catalogId en este budget — para que
    //      el WC del baño principal y el del baño secundario queden
    //      iguales sin que MJ tenga que actualizar uno por uno.
    //   2. El catálogo BLARQ global — para que la próxima cotización ya
    //      arranque con el dato actualizado.
    //
    // Lo que NO se sincroniza:
    //   - quantity (es por baño)
    //   - room, subcategory, sortOrder (ubicación dentro del budget)
    //   - realCostBlarq (puede variar caso a caso si negociás un
    //     descuento extra para un proyecto)
    //   - catalogId (obvio)
    if (item.catalogId) {
      const shared = {
        name: item.name,
        detail: item.detail,
        brand: item.brand,
        listPrice: item.listPrice,
        discountPercent: item.discountPercent,
        clientPrice: item.clientPrice,
        referenceLink: item.referenceLink,
        imageUrl: item.imageUrl,
      };

      // Otras copias en el mismo budget
      await prisma.artefactoItem.updateMany({
        where: {
          budgetVersionId,
          catalogId: item.catalogId,
          id: { not: itemId },
        },
        data: shared,
      });

      // Catálogo BLARQ
      await prisma.artefactoCatalog
        .update({
          where: { id: item.catalogId },
          data: {
            name: shared.name,
            detail: shared.detail,
            brand: shared.brand,
            listPrice: shared.listPrice,
            discountPercent: shared.discountPercent,
            referenceLink: shared.referenceLink,
            imageUrl: shared.imageUrl,
            lastPriceCheck: new Date(),
          },
        })
        .catch(() => {
          /* puede haberse borrado del catálogo — ignorar */
        });
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating artefacto item:", error);
    return NextResponse.json(
      { error: "Error al actualizar artefacto" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    await prisma.artefactoItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting artefacto item:", error);
    return NextResponse.json(
      { error: "Error al eliminar artefacto" },
      { status: 500 }
    );
  }
}
