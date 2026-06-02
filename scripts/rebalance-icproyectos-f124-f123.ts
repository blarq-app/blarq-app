// Corrige la sobre-imputación de f124 ICPROYECTOS y completa f123, según el
// reparto que MJ hizo a mano en Maxxa del movimiento de 06-may ($1.000.000):
//   - f124 ICPROYECTOS ($185.000): su pago baja de $1.000.000 → $185.000.
//   - f123 ICPROYECTOS ($2.023.015): recibe los $815.000 sobrantes del 06-may
//     + el movimiento del 07-may ($1.208.015) = $2.023.015 → pagada.
// El movimiento de 06-may queda repartido $185.000 (f124) + $815.000 (f123) =
// $1.000.000 (sin sobra). autoMatched=false (manual de MJ).
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/rebalance-icproyectos-f124-f123.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/ep-shy-morning/.test(url)) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`rebalance-icproyectos-f124-f123 — ${APPLY ? "APPLY" : "DRY-RUN"} | prod\n`);

  const f124 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "124", businessName: { contains: "ICPROYEC", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true, amountApplied: true, bankMovementId: true, bankMovement: { select: { date: true, amount: true } } } } } });
  const f123 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "123", businessName: { contains: "ICPROYEC", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true } } } });
  // movimiento 07-may $1.208.015 sin_asignar
  const mov0507 = await prisma.bankMovement.findFirst({ where: { bankAccountId: "ba_op_blarq", status: "sin_asignar", counterpartyRut: { contains: "76905968" }, amount: -1208015 },
    select: { id: true } });

  // el pago de f124 que sobre-imputa (debe ser el del mov 06-may por $1.000.000)
  const pagoMalo = f124?.payments.find((p) => p.amountApplied === 1000000 && Math.abs(p.bankMovement?.amount ?? 0) === 1000000);

  const problems: string[] = [];
  if (!f124) problems.push("no encontré f124");
  if (!f123) problems.push("no encontré f123"); else if (f123.payments.length) problems.push(`f123 ya tiene ${f123.payments.length} pagos (esperaba 0)`);
  if (!pagoMalo) problems.push("no encontré el pago de $1.000.000 en f124");
  if (!mov0507) problems.push("no encontré el mov 07-may $1.208.015 sin_asignar");

  console.log(`f124: ${f124 ? fmt(f124.totalAmount) + " [" + f124.status + "], pagado " + fmt(f124.payments.reduce((s, p) => s + p.amountApplied, 0)) : "—"}`);
  console.log(`f123: ${f123 ? fmt(f123.totalAmount) + " [" + f123.status + "], pagado " + fmt(f123?.payments.length ? 0 : 0) : "—"}`);
  console.log(`\nPlan: f124 pago $1.000.000 → $185.000 · f123 ← $815.000 (06-may) + $1.208.015 (07-may)`);
  if (problems.length) { console.log(`\nABORTO:\n - ${problems.join("\n - ")}`); await prisma.$disconnect(); return; }

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  // 1. bajar el pago de f124 a $185.000
  await prisma.invoicePayment.update({ where: { id: pagoMalo!.id }, data: { amountApplied: 185000 } });
  // 2. los $815.000 del mismo mov (06-may) → f123
  await prisma.invoicePayment.create({ data: { bankMovementId: pagoMalo!.bankMovementId, invoiceId: f123!.id, amountApplied: 815000, autoMatched: false } });
  // 3. el mov 07-may ($1.208.015) → f123
  await prisma.invoicePayment.create({ data: { bankMovementId: mov0507!.id, invoiceId: f123!.id, amountApplied: 1208015, autoMatched: false } });
  await prisma.bankMovement.update({ where: { id: mov0507!.id }, data: { status: "conciliado" } });
  await recomputeInvoiceStatus(f124!.id);
  await recomputeInvoiceStatus(f123!.id);

  // ── verificación ──
  const v124 = await prisma.invoice.findUnique({ where: { id: f124!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  const v123 = await prisma.invoice.findUnique({ where: { id: f123!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  console.log(`\nEscrito.`);
  console.log(`f124 ahora: [${v124!.status}] pagado ${fmt(v124!.payments.reduce((s, p) => s + p.amountApplied, 0))} (debe ser $185.000)`);
  console.log(`f123 ahora: [${v123!.status}] pagado ${fmt(v123!.payments.reduce((s, p) => s + p.amountApplied, 0))} (debe ser $2.023.015)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
