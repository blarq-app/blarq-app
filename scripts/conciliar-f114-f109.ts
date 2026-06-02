// Concilia f114 ICPROYECTOS y completa f109 CUADROS según la cartola Maxxa de MJ.
//   - f114 ICPROYECTOS ($6.069.000, vacía) ← Icproyectos 12-feb $1.000.000 +
//     17-feb $5.069.000 (= total exacto). Las dos están sin_asignar.
//   - f109 CUADROS ($790.001, parcial, ya tiene el pago del 12-jun $395.000)
//     ← agrega el del 03-abr $395.000 → pagada. (Maxxa: ambas a f109.)
//     De paso arregla el estado del mov del 12-jun (quedó sin_asignar pese a
//     tener su pago a f109, por el despegado anterior).
// autoMatched=false (conciliación manual de MJ).
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-f114-f109.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/ep-shy-morning/.test(url)) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`conciliar-f114-f109 — ${APPLY ? "APPLY" : "DRY-RUN"} | prod\n`);

  // ── f114 ICPROYECTOS ← 12-feb $1.000.000 + 17-feb $5.069.000 ──
  const f114 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "114", businessName: { contains: "ICPROYEC", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true } } } });
  const icpFeb = await prisma.bankMovement.findMany({ where: { bankAccountId: "ba_op_blarq", status: "sin_asignar", counterpartyRut: { contains: "76905968" }, amount: { in: [-1000000, -5069000] } },
    select: { id: true, date: true, amount: true } });

  // ── f109 CUADROS: agregar 03-abr $395.000; arreglar estado del 12-jun ──
  const f109 = await prisma.invoice.findFirst({ where: { type: "recibida", folioNumber: "109", businessName: { contains: "CUADROS", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { amountApplied: true } } } });
  // el mov 03-abr: $395.000 Cuadros sin_asignar SIN pago (el realmente libre)
  const cuadrosMovs = await prisma.bankMovement.findMany({ where: { bankAccountId: "ba_op_blarq", counterpartyRut: { contains: "72608888" }, amount: -395000 },
    select: { id: true, date: true, status: true, payments: { select: { invoiceId: true } } } });
  const c0403 = cuadrosMovs.find((m) => m.payments.length === 0);            // 03-abr, libre → agregar a f109
  const c1206 = cuadrosMovs.find((m) => m.payments.some((p) => p.invoiceId === f109?.id) && m.status !== "conciliado"); // 12-jun, ya paga f109 pero mal estado

  // validaciones
  const problems: string[] = [];
  if (!f114) problems.push("no encontré f114"); else if (f114.payments.length) problems.push(`f114 ya tiene ${f114.payments.length} pagos`);
  if (icpFeb.length !== 2) problems.push(`esperaba 2 movs Icproyectos feb, encontré ${icpFeb.length}`);
  else if (icpFeb.reduce((s, m) => s + Math.abs(m.amount), 0) !== (f114?.totalAmount ?? -1)) problems.push("los 2 movs feb no suman el total de f114");
  if (!f109) problems.push("no encontré f109 Cuadros");
  if (!c0403) problems.push("no encontré el mov Cuadros 03-abr libre");

  const f109Paid = f109?.payments.reduce((s, p) => s + p.amountApplied, 0) ?? 0;
  console.log(`f114 ICPROYECTOS: ${f114 ? fmt(f114.totalAmount) + " [" + f114.status + "]" : "—"} ← ${icpFeb.map((m) => fmt(Math.abs(m.amount))).join(" + ")}`);
  console.log(`f109 CUADROS: ${f109 ? fmt(f109.totalAmount) + " [" + f109.status + "], pagado " + fmt(f109Paid) : "—"} ← agregar 03-abr $395.000 (y arreglar estado 12-jun: ${c1206 ? "sí" : "ya ok/n/a"})`);
  if (problems.length) { console.log(`\nABORTO:\n - ${problems.join("\n - ")}`); await prisma.$disconnect(); return; }

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  for (const m of icpFeb) {
    await prisma.invoicePayment.create({ data: { bankMovementId: m.id, invoiceId: f114!.id, amountApplied: Math.abs(m.amount), autoMatched: false } });
    await prisma.bankMovement.update({ where: { id: m.id }, data: { status: "conciliado" } });
  }
  await recomputeInvoiceStatus(f114!.id);

  await prisma.invoicePayment.create({ data: { bankMovementId: c0403!.id, invoiceId: f109!.id, amountApplied: 395000, autoMatched: false } });
  await prisma.bankMovement.update({ where: { id: c0403!.id }, data: { status: "conciliado" } });
  if (c1206) await prisma.bankMovement.update({ where: { id: c1206.id }, data: { status: "conciliado" } });
  await recomputeInvoiceStatus(f109!.id);

  // ── verificación ──
  const v114 = await prisma.invoice.findUnique({ where: { id: f114!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  const v109 = await prisma.invoice.findUnique({ where: { id: f109!.id }, select: { status: true, payments: { select: { amountApplied: true } } } });
  console.log(`\nEscrito.`);
  console.log(`f114 ahora: [${v114!.status}] pagado ${fmt(v114!.payments.reduce((s, p) => s + p.amountApplied, 0))}`);
  console.log(`f109 ahora: [${v109!.status}] pagado ${fmt(v109!.payments.reduce((s, p) => s + p.amountApplied, 0))}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
