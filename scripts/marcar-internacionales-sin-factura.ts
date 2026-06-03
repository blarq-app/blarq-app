// Igual que marcar-google: marca Claude.ai y Hostinger como "sin_factura"
// (suscripción internacional, sin factura chilena) y crea reglas para que los
// próximos imports lo hagan solos. Confirmado MJ 2026-06-03.
// Solo toca movimientos SIN imputación.
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/marcar-internacionales-sin-factura.ts
// Uso (APLICAR): ...mismo... scripts/marcar-internacionales-sin-factura.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CATEGORIA = "otro_sin_factura";
const PATRONES = ["CLAUDE", "HOSTINGER"];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No es prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const backup: { id: string; status: string; category: string | null }[] = [];
  for (const patron of PATRONES) {
    const movs = await prisma.bankMovement.findMany({
      where: { description: { contains: patron, mode: "insensitive" }, payments: { none: {} } },
      select: { id: true, date: true, amount: true, status: true, category: true, description: true },
      orderBy: { date: "desc" },
    });
    console.log(`=== ${patron}: ${movs.length} movimientos sin imputación ===`);
    for (const m of movs) console.log(`  ${m.date.toISOString().slice(0,10)} ${String(m.amount).padStart(9)} [${m.status}/${m.category}]  ${m.description}`);

    if (APPLY && movs.length) {
      backup.push(...movs.map((m) => ({ id: m.id, status: m.status, category: m.category })));
      const r = await prisma.bankMovement.updateMany({ where: { id: { in: movs.map((m) => m.id) } }, data: { status: "sin_factura", category: CATEGORIA } });
      await prisma.bankCategorizationRule.upsert({
        where: { descriptionPattern_category: { descriptionPattern: patron, category: CATEGORIA } },
        create: { descriptionPattern: patron, category: CATEGORIA, hits: r.count },
        update: { hits: { increment: r.count } },
      });
      console.log(`  -> ${r.count} a sin_factura/${CATEGORIA}. Regla "${patron}" lista.`);
    }
  }

  if (!APPLY) { console.log("\nDRY-RUN. --apply para escribir."); await prisma.$disconnect(); return; }
  writeFileSync("marcar-internacionales-backup.json", JSON.stringify(backup, null, 2), "utf8");
  console.log("\nRespaldo: marcar-internacionales-backup.json");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
