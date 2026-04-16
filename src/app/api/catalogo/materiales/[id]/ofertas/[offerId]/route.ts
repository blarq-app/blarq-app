import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const { id, offerId } = await params;
  const data = await req.json();

  const offer = await prisma.materialPriceOffer.update({
    where: { id: offerId },
    data: {
      store: data.store,
      productName: data.productName,
      productUrl: data.productUrl,
      price: data.price,
      priceNet: data.priceNet ?? (data.price ? data.price / 1.19 : undefined),
      available: data.available,
      isPinned: data.isPinned,
      notes: data.notes,
    },
  });

  // Si este se pinea, despinear otros del mismo material
  if (data.isPinned) {
    await prisma.materialPriceOffer.updateMany({
      where: { materialId: id, id: { not: offerId } },
      data: { isPinned: false },
    });

    // Actualizar material netPrice
    if (offer.priceNet) {
      await prisma.materialCatalog.update({
        where: { id },
        data: {
          netPrice: offer.priceNet,
          referenceLink: offer.productUrl,
          lastUpdated: new Date(),
        },
      });
    }
  }

  return NextResponse.json(offer);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const { offerId } = await params;
  await prisma.materialPriceOffer.delete({ where: { id: offerId } });
  return NextResponse.json({ ok: true });
}
