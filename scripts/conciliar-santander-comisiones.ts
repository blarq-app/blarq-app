// Concilia las facturas mensuales del Banco Santander (RUT 97036000-K) con sus
// DOS cargos del banco: COM.MANTENCION PLAN + COM.MANT.PROD.OPC.T.REDBANC, que
// sumados dan el total de la factura (caso "split": dos movimientos -> una
// factura). Solo facturas abiertas (pendiente/parcial). Confirmado MJ 2026-06-03.
//
// Para cada factura abierta del Santander:
//   - busca, sin imputación y dentro de ±5 días, el cargo MANTENCION y el REDBANC
//   - crea un InvoicePayment por cada uno (amountApplied = |monto del cargo|)
//   - marca ambos movimientos "conciliado" y recalcula el status de la factura
// Si no encuentra los dos, o ya están imputados, NO toca esa factura (la anota).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-santander-comisiones.ts
// Uso (APLICAR): ...mismo... scripts/conciliar-santander-comisiones.ts --apply

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DAY = 86400000;

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

  const facs = await prisma.invoice.findMany({
    where: { type: "recibida", rutIssuer: { contains: "97036000" }, status: { in: ["pendiente", "parcial"] } },
    select: { id: true, folioNumber: true, issueDate: true, totalAmount: true, status: true, payments: { select: { id: true } } },
    orderBy: { issueDate: "desc" },
  });

  // Candidatos: cargos del banco sin imputación.
  const movs = await prisma.bankMovement.findMany({
    where: { amount: { lt: 0 }, payments: { none: {} }, OR: [
      { description: { contains: "MANTENCION PLAN", mode: "insensitive" } },
      { description: { contains: "MANT.PROD", mode: "insensitive" } },
      { description: { contains: "REDBANC", mode: "insensitive" } },
    ] },
    select: { id: true, date: true, amount: true, description: true },
  });
  const esMant = (d: string) => /MANTENCION PLAN/i.test(d);
  const esRedbanc = (d: string) => /REDBANC|MANT\.PROD/i.test(d);
  const usados = new Set<string>();

  let conciliadas = 0;
  const pendientesRevisar: string[] = [];

  for (const f of facs) {
    if (f.payments.length > 0) { pendientesRevisar.push(`folio ${f.folioNumber}: ya tiene imputación, omito`); continue; }
    const cerca = movs.filter((m) => !usados.has(m.id) && Math.abs(new Date(m.date).getTime() - new Date(f.issueDate).getTime()) / DAY <= 5);
    const mant = cerca.find((m) => esMant(m.description));
    const red = cerca.find((m) => esRedbanc(m.description));
    if (!mant || !red) { pendientesRevisar.push(`folio ${f.folioNumber} ($${f.totalAmount}, ${f.issueDate.toISOString().slice(0,10)}): no encuentro los dos cargos (mant:${!!mant} redbanc:${!!red})`); continue; }
    const suma = Math.abs(mant.amount) + Math.abs(red.amount);
    const cierra = suma >= f.totalAmount - 1;
    console.log(`folio ${f.folioNumber} $${f.totalAmount} (${f.issueDate.toISOString().slice(0,10)})  <-  mant ${mant.amount} + redbanc ${red.amount} = ${-suma}  => ${cierra ? "cierra (pagada)" : `queda parcial, saldo ${f.totalAmount - suma}`}`);
    usados.add(mant.id); usados.add(red.id);

    if (APPLY) {
      await prisma.invoicePayment.create({ data: { bankMovementId: mant.id, invoiceId: f.id, amountApplied: Math.abs(mant.amount), autoMatched: true } });
      await prisma.invoicePayment.create({ data: { bankMovementId: red.id, invoiceId: f.id, amountApplied: Math.abs(red.amount), autoMatched: true } });
      await prisma.bankMovement.updateMany({ where: { id: { in: [mant.id, red.id] } }, data: { status: "conciliado" } });
      await recompute(f.id);
    }
    conciliadas++;
  }

  console.log(`\n${conciliadas} facturas Santander ${APPLY ? "conciliadas" : "a conciliar"}.`);
  if (pendientesRevisar.length) { console.log("No tocadas:"); pendientesRevisar.forEach((p) => console.log("  " + p)); }
  if (!APPLY) console.log("\nDRY-RUN. --apply para escribir.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
