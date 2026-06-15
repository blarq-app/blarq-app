import { prisma } from "@/lib/prisma";
import { syncMaterialToComponents } from "@/lib/catalog/syncMaterial";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// GET: listar ofertas del material
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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

  // Si se crea como fijada, pasa a ser la fuente oficial del catálogo:
  // despinear las otras, actualizar netPrice + link y propagar a partidas.
  if (offer.isPinned && offer.priceNet) {
    await prisma.materialPriceOffer.updateMany({
      where: { materialId: id, id: { not: offer.id } },
      data: { isPinned: false },
    });
    await prisma.materialCatalog.update({
      where: { id },
      data: {
        netPrice: offer.priceNet,
        referenceLink: offer.productUrl,
        lastUpdated: new Date(),
        lastResearchAt: new Date(),
      },
    });
    await syncMaterialToComponents(id, { propagateToBudgets: false });
  } else {
    await prisma.materialCatalog.update({
      where: { id },
      data: { lastResearchAt: new Date() },
    });
  }

  return NextResponse.json(offer);
}
