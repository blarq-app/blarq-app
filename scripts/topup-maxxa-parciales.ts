// Completa 6 pagos parciales que la conciliación de Maxxa dice más altos que lo
// que la app tiene. El script general (conciliar-maxxa-2025) sabe CREAR links
// pero no AGRANDAR uno existente, y re-correrlo duplicaría el de Servipag. Acá
// se sube cada pago al monto correcto, con TOPE por saldo de factura y por
// capacidad del movimiento (imposible sobre-imputar). Decisión MJ 2026-06-03.
//
// Cada target se identifica por (folio, tipo de factura, fecha+monto del mov).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/topup-maxxa-parciales.ts
// Uso (APLICAR): ...mismo... scripts/topup-maxxa-parciales.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// target = monto FINAL que debe tener el pago de ese (movimiento, factura).
const TARGETS = [
  { folio: "92", type: "emitida", movDate: "2025-05-27", movAmount: 350000, glosa: "Geof", target: 350000 },
  { folio: "109", type: "emitida", movDate: "2025-08-01", movAmount: 2643072, glosa: "Juan Jose", target: 2643072 },
  { folio: "1", type: "recibida", movDate: "2025-07-07", movAmount: -261000, glosa: "Ruben", target: 261000 },
  { folio: "17824952", type: "recibida", movDate: "2025-08-12", movAmount: -87311, glosa: "TAG", target: 20846 },
  { folio: "5705931", type: "recibida", movDate: "2025-05-20", movAmount: -54845, glosa: "SERVIPAG", target: 12275 },
];

async function recompute(id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { totalAmount: true, status: true } });
  if (!inv || inv.status === "anulada") return;
  const ps = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, select: { amountApplied: true, bankMovement: { select: { date: true } } } });
  const sum = ps.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente"; let paidAt: Date | null = null;
  if (sum >= inv.totalAmount - 1) { status = "pagada"; paidAt = ps.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null); }
  else if (sum > 0) status = "parcial";
  await prisma.invoice.update({ where: { id }, data: { status, paidAt } });
}

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No es prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const backup: any[] = [];
  for (const t of TARGETS) {
    const inv = await prisma.invoice.findFirst({
      where: { folioNumber: t.folio, type: t.type },
      select: { id: true, totalAmount: true, businessName: true, status: true, payments: { select: { id: true, amountApplied: true, bankMovementId: true } } },
    });
    const d0 = new Date(t.movDate + "T00:00:00Z"), d1 = new Date(t.movDate + "T23:59:59Z");
    const mov = await prisma.bankMovement.findFirst({
      where: { amount: t.movAmount, date: { gte: d0, lte: d1 }, description: { contains: t.glosa, mode: "insensitive" } },
      select: { id: true, amount: true, description: true, payments: { select: { id: true, amountApplied: true, invoiceId: true } } },
    });
    if (!inv || !mov) { console.log(`SKIP folio ${t.folio} ${t.type}: ${!inv ? "no factura" : "no movimiento"}`); continue; }

    const pair = inv.payments.find((p) => p.bankMovementId === mov.id);
    const cur = pair?.amountApplied ?? 0;
    const invOther = inv.payments.filter((p) => p.bankMovementId !== mov.id).reduce((s, p) => s + p.amountApplied, 0);
    const movOther = mov.payments.filter((p) => p.invoiceId !== inv.id).reduce((s, p) => s + p.amountApplied, 0);
    const capInv = inv.totalAmount - invOther;          // lo máx que este pago puede llegar sin pasar la factura
    const capMov = Math.abs(mov.amount) - movOther;     // ... sin pasar el movimiento
    const newAmount = Math.min(t.target, capInv, capMov);

    const warn = newAmount < t.target ? `  (¡tope! target ${t.target} pero cap ${Math.min(capInv, capMov)})` : "";
    console.log(`F-${t.folio} ${t.type} "${(inv.businessName||"").slice(0,22)}"  pago ${cur} -> ${newAmount}  (factura $${inv.totalAmount})${warn}`);

    if (APPLY && newAmount > cur) {
      backup.push({ invoiceId: inv.id, bankMovementId: mov.id, prevAmount: cur, paymentId: pair?.id ?? null });
      if (pair) await prisma.invoicePayment.update({ where: { id: pair.id }, data: { amountApplied: newAmount } });
      else await prisma.invoicePayment.create({ data: { invoiceId: inv.id, bankMovementId: mov.id, amountApplied: newAmount, autoMatched: false } });
      // status del movimiento
      const ap = (await prisma.invoicePayment.aggregate({ where: { bankMovementId: mov.id }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0;
      await prisma.bankMovement.update({ where: { id: mov.id }, data: { status: ap >= Math.abs(mov.amount) - 1 ? "conciliado" : "parcial" } });
      await recompute(inv.id);
    }
  }

  if (!APPLY) { console.log("\nDRY-RUN. --apply para escribir."); await prisma.$disconnect(); return; }
  writeFileSync("topup-maxxa-backup.json", JSON.stringify(backup, null, 2), "utf8");
  console.log(`\nRespaldo: topup-maxxa-backup.json. ${backup.length} pagos ajustados.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
