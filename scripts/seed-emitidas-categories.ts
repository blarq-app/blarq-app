// Seed de las 3 categorías para facturas EMITIDAS (lo que BLARQ cobra
// al cliente): Obra, Muebles, Artefactos. Idempotente — usa upsert por
// (name, parentId=null, appliesTo="emitida").

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const EMITIDAS = [
  { name: "Obra", sortOrder: 1 },
  { name: "Muebles", sortOrder: 2 },
  { name: "Artefactos", sortOrder: 3 },
];

async function main() {
  for (const cat of EMITIDAS) {
    const existing = await prisma.costCategory.findFirst({
      where: { name: cat.name, parentId: null, appliesTo: "emitida" },
    });
    if (existing) {
      console.log(`  · ${cat.name}: ya existe (skip)`);
      continue;
    }
    await prisma.costCategory.create({
      data: {
        name: cat.name,
        appliesTo: "emitida",
        sortOrder: cat.sortOrder,
        type: "directo",
      },
    });
    console.log(`  ✓ ${cat.name} creada`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
