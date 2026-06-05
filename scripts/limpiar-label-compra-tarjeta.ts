// Borra la categoría "compra_tarjeta" de los movimientos (la deja en null). Es
// el método de pago, no aporta nada contable (no dice qué se compró ni para qué
// obra) y era un resabio del bug del prefijo "Compra". Decisión MJ 2026-06-03.
// No cambia status ni imputaciones, solo limpia el label.
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/limpiar-label-compra-tarjeta.ts
// Uso (APLICAR): ...mismo... scripts/limpiar-label-compra-tarjeta.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No es prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}`);

  const movs = await prisma.bankMovement.findMany({
    where: { category: "compra_tarjeta" },
    select: { id: true, status: true },
  });
  const porEstado: Record<string, number> = {};
  for (const m of movs) porEstado[m.status] = (porEstado[m.status] ?? 0) + 1;
  console.log(`Movimientos con category="compra_tarjeta": ${movs.length}`, porEstado);
  console.log("Acción: category -> null (no toca status ni pagos).");

  if (!APPLY) { console.log("\nDRY-RUN. --apply para escribir."); await prisma.$disconnect(); return; }

  writeFileSync("limpiar-label-backup.json", JSON.stringify(movs.map((m) => m.id), null, 2), "utf8");
  const r = await prisma.bankMovement.updateMany({ where: { category: "compra_tarjeta" }, data: { category: null } });
  console.log(`Respaldo: limpiar-label-backup.json\nLISTO. ${r.count} movimientos con category limpiada.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
