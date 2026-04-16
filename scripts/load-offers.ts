import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

type Offer = {
  store: string;
  productName: string;
  productUrl?: string;
  price: number;
  matchType?: string;
  notes?: string;
};

type MaterialResult = {
  materialId: string;
  materialName: string;
  offers: Offer[];
  skippedReason?: string | null;
};

async function main() {
  const data: MaterialResult[] = JSON.parse(
    fs.readFileSync(
      "/Users/mjblanco/Desktop/blarq-app/scripts/lefevre-offers.json",
      "utf-8"
    )
  );

  let totalCreated = 0;
  let materialsUpdated = 0;

  for (const mat of data) {
    if (!mat.offers || mat.offers.length === 0) continue;

    // Verificar que el material existe
    const exists = await prisma.materialCatalog.findUnique({
      where: { id: mat.materialId },
    });
    if (!exists) {
      console.log(`⚠ Material ${mat.materialName} (${mat.materialId}) no encontrado, skip`);
      continue;
    }

    // Borrar ofertas previas de este material (fresh start)
    await prisma.materialPriceOffer.deleteMany({
      where: { materialId: mat.materialId },
    });

    let cheapest: Offer | null = null;
    let cheapestId: string | null = null;

    for (const offer of mat.offers) {
      if (!offer.price || offer.price <= 0) continue;

      const created = await prisma.materialPriceOffer.create({
        data: {
          materialId: mat.materialId,
          store: offer.store.toLowerCase(),
          productName: offer.productName || mat.materialName,
          productUrl: offer.productUrl || null,
          price: offer.price,
          priceNet: Math.round(offer.price / 1.19),
          available: true,
          isPinned: false,
          notes:
            [
              offer.matchType === "equivalent" ? "equivalente" : null,
              offer.notes || null,
            ]
              .filter(Boolean)
              .join(" · ") || null,
        },
      });

      // Historial
      await prisma.materialPriceHistory.create({
        data: {
          materialId: mat.materialId,
          store: offer.store.toLowerCase(),
          price: offer.price,
        },
      });

      if (!cheapest || offer.price < cheapest.price) {
        cheapest = offer;
        cheapestId = created.id;
      }

      totalCreated++;
    }

    // Pin el más barato
    if (cheapestId && cheapest) {
      await prisma.materialPriceOffer.update({
        where: { id: cheapestId },
        data: { isPinned: true },
      });

      // Actualizar netPrice del catálogo con el precio neto más barato
      const netPrice = Math.round(cheapest.price / 1.19);
      await prisma.materialCatalog.update({
        where: { id: mat.materialId },
        data: {
          netPrice,
          referenceLink: cheapest.productUrl || exists.referenceLink,
          lastUpdated: new Date(),
          lastResearchAt: new Date(),
        },
      });
      materialsUpdated++;
    }
  }

  console.log(`\n✓ ${totalCreated} ofertas creadas`);
  console.log(`✓ ${materialsUpdated} materiales actualizados con precio más barato`);
  console.log(`✓ Precios del catálogo actualizados a valores de mercado`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
