import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET: listar ofertas del material
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const offers = await prisma.materialPriceOffer.findMany({
    where: { materialId: id },
    orderBy: [{ isPinned: "desc" }, { price: "asc" }],
  });
  return NextResponse.json(offers);
}

// POST: crear nueva oferta
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();

  const offer = await prisma.materialPriceOffer.create({
    data: {
      materialId: id,
      store: data.store,
      productName: data.productName,
      productUrl: data.productUrl || null,
      price: data.price,
      priceNet: data.priceNet ?? data.price / 1.19,
      available: data.available ?? true,
      isPinned: data.isPinned ?? false,
      notes: data.notes || null,
    },
  });

  // Historial
  await prisma.materialPriceHistory.create({
    data: {
      materialId: id,
      store: data.store,
      price: data.price,
    },
  });

  // Si es pin y el precio neto es mejor que el actual, actualizar netPrice + link
  if (offer.isPinned && offer.priceNet) {
    await prisma.materialCatalog.update({
      where: { id },
      data: {
        netPrice: offer.priceNet,
        referenceLink: offer.productUrl,
        lastUpdated: new Date(),
        lastResearchAt: new Date(),
      },
    });
  } else {
    await prisma.materialCatalog.update({
      where: { id },
      data: { lastResearchAt: new Date() },
    });
  }

  return NextResponse.json(offer);
}
