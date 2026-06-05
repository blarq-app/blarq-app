// Marca los movimientos de Google (Workspace/GSuite) como "sin_factura": son
// suscripción internacional y NO emiten factura chilena. Confirmado MJ 2026-06-03.
// Además crea/actualiza una REGLA de categorización (patrón "GOOGLE") para que
// los próximos imports lo clasifiquen solos — así no vuelven a la cola ni
// dependen del bug del prefijo "Compra" que ya sacamos.
//
// Categoría usada: "otro_sin_factura" (existente, sin inventar taxonomía nueva;
// cuando definamos categorías finas se puede renombrar a "internacional").
// Solo toca movimientos SIN imputación (no pisa nada conciliado).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/marcar-google-sin-factura.ts
// Uso (APLICAR): ...mismo... scripts/marcar-google-sin-factura.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CATEGORIA = "otro_sin_factura";
const PATRON = "GOOGLE";

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No es prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const movs = await prisma.bankMovement.findMany({
    where: { description: { contains: "GOOGLE", mode: "insensitive" }, payments: { none: {} } },
    select: { id: true, date: true, amount: true, status: true, category: true, description: true },
    orderBy: { date: "desc" },
  });
  console.log(`Movimientos Google sin imputación: ${movs.length}`);
  for (const m of movs) console.log(`  ${m.date.toISOString().slice(0,10)} ${String(m.amount).padStart(9)} [${m.status}/${m.category}]  ${m.description}`);

  if (!APPLY) { console.log(`\nQuedarían: status=sin_factura, category=${CATEGORIA}. Regla "${PATRON}" -> ${CATEGORIA}.\nDRY-RUN. --apply para escribir.`); await prisma.$disconnect(); return; }

  writeFileSync("marcar-google-backup.json", JSON.stringify(movs.map((m) => ({ id: m.id, status: m.status, category: m.category })), null, 2), "utf8");
  console.log("\nRespaldo: marcar-google-backup.json");

  const r = await prisma.bankMovement.updateMany({ where: { id: { in: movs.map((m) => m.id) } }, data: { status: "sin_factura", category: CATEGORIA } });
  await prisma.bankCategorizationRule.upsert({
    where: { descriptionPattern_category: { descriptionPattern: PATRON, category: CATEGORIA } },
    create: { descriptionPattern: PATRON, category: CATEGORIA, hits: r.count },
    update: { hits: { increment: r.count } },
  });
  console.log(`LISTO. ${r.count} movimientos -> sin_factura/${CATEGORIA}. Regla "${PATRON}" creada/actualizada.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
