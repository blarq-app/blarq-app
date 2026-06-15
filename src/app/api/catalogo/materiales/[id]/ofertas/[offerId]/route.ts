import { prisma } from "@/lib/prisma";
import { syncMaterialToComponents } from "@/lib/catalog/syncMaterial";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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

  // Si este se pinea, despinear otros del mismo material y volverlo la
  // fuente oficial del catálogo (netPrice + link).
  if (data.isPinned) {
    await prisma.materialPriceOffer.updateMany({
      where: { materialId: id, id: { not: offerId } },
      data: { isPinned: false },
    });

    if (offer.priceNet) {
      await prisma.materialCatalog.update({
        where: { id },
        data: {
          netPrice: offer.priceNet,
          referenceLink: offer.productUrl,
          lastUpdated: new Date(),
          lastResearchAt: new Date(),
        },
      });
      // Propagar el precio nuevo a las partidas que usan este material.
      // Sin esto, fijar una oferta cambiaba el catálogo pero dejaba las
      // partidas con el precio viejo.
      await syncMaterialToComponents(id, { propagateToBudgets: false });
    }
  }

  return NextResponse.json(offer);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { offerId } = await params;
  await prisma.materialPriceOffer.delete({ where: { id: offerId } });
  return NextResponse.json({ ok: true });
}
