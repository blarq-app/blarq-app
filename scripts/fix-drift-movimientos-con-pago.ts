// Corrige el desajuste de estado: movimientos que TIENEN imputación
// (InvoicePayment) pero quedaron en "sin_asignar"/"sin_factura" — se ven
// "pendiente" en la app aunque ya están conciliados. Recalcula el estado:
//   pago cubre el total (±$1) -> conciliado
//   pago no cubre todo        -> parcial
// No crea ni borra pagos, no toca facturas: solo el status del movimiento.
// No afecta métricas (cobrado/gastado salen de las facturas, no del status).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/fix-drift-movimientos-con-pago.ts
// Uso (APLICAR): ...mismo... scripts/fix-drift-movimientos-con-pago.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No es prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const movs = await prisma.bankMovement.findMany({
    where: { payments: { some: {} }, status: { in: ["sin_asignar", "sin_factura"] } },
    select: { id: true, amount: true, status: true, date: true, description: true, payments: { select: { amountApplied: true } } },
    orderBy: { date: "asc" },
  });

  const cubre = (m: typeof movs[number]) => m.payments.reduce((s, p) => s + p.amountApplied, 0) >= Math.abs(m.amount) - 1;
  const aConciliado = movs.filter(cubre);
  const aParcial = movs.filter((m) => !cubre(m));

  console.log(`Movimientos con pago pero en pendiente: ${movs.length}`);
  console.log(`  -> conciliado: ${aConciliado.length}   -> parcial: ${aParcial.length}\n`);
  if (aParcial.length) {
    console.log("Quedan parcial (pago no cubre todo):");
    for (const m of aParcial) console.log(`  ${m.date.toISOString().slice(0,10)} ${m.amount} (aplicado ${m.payments.reduce((s,p)=>s+p.amountApplied,0)}) ${m.description}`);
  }

  if (!APPLY) { console.log("\nDRY-RUN. --apply para escribir."); await prisma.$disconnect(); return; }

  writeFileSync("fix-drift-backup.json", JSON.stringify(movs.map((m) => ({ id: m.id, status: m.status })), null, 2), "utf8");
  const c1 = aConciliado.length ? (await prisma.bankMovement.updateMany({ where: { id: { in: aConciliado.map((m) => m.id) } }, data: { status: "conciliado" } })).count : 0;
  const c2 = aParcial.length ? (await prisma.bankMovement.updateMany({ where: { id: { in: aParcial.map((m) => m.id) } }, data: { status: "parcial" } })).count : 0;
  console.log(`Respaldo: fix-drift-backup.json\nLISTO. conciliado:${c1} parcial:${c2}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
