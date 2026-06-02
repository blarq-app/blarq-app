// Concilia dos facturas según la asignación que MJ hizo a mano en Maxxa
// (verdad manual), tras encontrar la respuesta en la cartola Maxxa:
//   - f75 DELPHINCLEAN ($309.400, vacía) ← Nelson Gil $130.000 + $179.400 (= total).
//   - f92 INVERSIONES DPM ($33.990, vacía) ← MercadoPago $33.990 (de un mov de
//     $37.389; el resto $3.399 es honorario de JT sin factura en la app → el mov
//     queda "parcial").
// "Nelson Gil" es la persona de DELPHINCLEAN. autoMatched=false (manual de MJ).
//
// NO toca Cuadros (3 transferencias iguales de $395.000, ambiguo) ni Icproyectos
// (f124 ya pagada, mov de feb fuera de rango) — esos quedan para MJ.
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-f75-f92.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/ep-shy-morning/.test(url)) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`conciliar-f75-f92 — ${APPLY ? "APPLY" : "DRY-RUN"} | prod\n`);

  // ── f75 DELPHINCLEAN ← Nelson Gil $130.000 + $179.400 ──
  const f75 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "75", businessName: { contains: "DELPHIN", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true } } } });
  const nelson = await prisma.bankMovement.findMany({ where: { bankAccountId: "ba_op_blarq", status: "sin_asignar", counterpartyRut: { contains: "46372910" }, amount: { in: [-130000, -179400] } },
    select: { id: true, date: true, amount: true, description: true } });

  // ── f92 INVERSIONES DPM ← MercadoPago $33.990 (de mov $37.389) ──
  const f92 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "92", businessName: { contains: "DPM", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true } } } });
  const mp = await prisma.bankMovement.findFirst({ where: { bankAccountId: "ba_op_blarq", amount: -37389, description: { contains: "MERCADOPAGO", mode: "insensitive" }, date: { gte: new Date("2025-05-29"), lte: new Date("2025-05-31") } },
    select: { id: true, date: true, amount: true, description: true, status: true } });

  // validaciones
  const problems: string[] = [];
  if (!f75) problems.push("no encontré f75 DELPHINCLEAN");
  else if (f75.payments.length) problems.push(`f75 ya tiene ${f75.payments.length} pagos`);
  if (nelson.length !== 2) problems.push(`esperaba 2 movs Nelson Gil, encontré ${nelson.length}`);
  if (!f92) problems.push("no encontré f92 DPM");
  else if (f92.payments.length) problems.push(`f92 ya tiene ${f92.payments.length} pagos`);
  if (!mp) problems.push("no encontré el mov MercadoPago $37.389 del 30-may");

  console.log(`f75 DELPHINCLEAN: ${f75 ? fmt(f75.totalAmount) + " [" + f75.status + "]" : "—"} ← ${nelson.map((m) => fmt(Math.abs(m.amount))).join(" + ")}`);
  console.log(`f92 INVERSIONES DPM: ${f92 ? fmt(f92.totalAmount) + " [" + f92.status + "]" : "—"} ← MercadoPago $33.990 (de ${mp ? fmt(Math.abs(mp.amount)) : "—"}, queda parcial)`);
  if (problems.length) { console.log(`\nABORTO:\n - ${problems.join("\n - ")}`); await prisma.$disconnect(); return; }

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  // f75: dos movimientos completos
  for (const m of nelson) {
    await prisma.invoicePayment.create({ data: { bankMovementId: m.id, invoiceId: f75!.id, amountApplied: Math.abs(m.amount), autoMatched: false } });
    await prisma.bankMovement.update({ where: { id: m.id }, data: { status: "conciliado" } });
  }
  await recomputeInvoiceStatus(f75!.id);
  // f92: pago parcial del mov MercadoPago ($33.990 de $37.389)
  await prisma.invoicePayment.create({ data: { bankMovementId: mp!.id, invoiceId: f92!.id, amountApplied: 33990, autoMatched: false } });
  await prisma.bankMovement.update({ where: { id: mp!.id }, data: { status: "parcial" } });
  await recomputeInvoiceStatus(f92!.id);

  // ── verificación ──
  const v75 = await prisma.invoice.findUnique({ where: { id: f75!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  const v92 = await prisma.invoice.findUnique({ where: { id: f92!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  console.log(`\nEscrito.`);
  console.log(`f75 ahora: [${v75!.status}] pagado ${fmt(v75!.payments.reduce((s, p) => s + p.amountApplied, 0))}`);
  console.log(`f92 ahora: [${v92!.status}] pagado ${fmt(v92!.payments.reduce((s, p) => s + p.amountApplied, 0))}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
