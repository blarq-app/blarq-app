// Concilia la factura JPB f173 (Quincho La Llaveria) con los 16 movimientos que
// MJ concilió a mano en Maxxa. Replica su trabajo manual (la verdad) en la app.
//
// Los 16 (según Maxxa, total abonos $4.501.650, saldo $300.000 de $4.801.650):
//   - 14 transferencias a Pedro Barrera (rut 11127176-3 / 5890859-2) = $2.935.000
//     (las que liberé al borrar los duplicados; EXCLUYE la de $2.000 "clavos").
//   - 1 transferencia a José Pérez (rut 15498717-7, persona de JPB) = $766.650.
//   - 1 transferencia a Iván Henríquez (rut 11677029-6) = $800.000, que la app
//     tenía mal como "traspaso interno" — MJ confirma que es pago de JPB. Se
//     desempareja (su contraparte "Transf de BLARQ SPA" vuelve a sin_asignar).
//
// Resultado: JPB f173 → parcial, pagada $4.501.650, saldo $300.000 (= Maxxa).
// autoMatched=false (es conciliación manual de MJ, no del algoritmo).
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-jpb-f173.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const env = /ep-shy-morning/.test(url) ? "prod" : "otro";
  console.log(`conciliar-jpb-f173 — ${APPLY ? "APPLY" : "DRY-RUN"} | ${env}\n`);
  if (env !== "prod") { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // factura JPB f173
  const f173 = await prisma.invoice.findFirst({
    where: { folioNumber: "173", businessName: { contains: "JPB" }, type: "recibida" },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true } } },
  });
  if (!f173) { console.log("No encontré JPB f173. Aborto."); await prisma.$disconnect(); return; }
  console.log(`JPB f173: total ${fmt(f173.totalAmount)} [${f173.status}] · pagos actuales: ${f173.payments.length}`);

  // ── seleccionar los 16 movimientos ──
  // 14 Pedro Barrera sin_asignar, EXCLUYE la de $2.000 (clavos)
  const pb = await prisma.bankMovement.findMany({
    where: { bankAccountId: "ba_op_blarq", status: "sin_asignar", amount: { lte: -100000 },
      OR: [{ counterpartyRut: { contains: "11271763" } }, { counterpartyRut: { contains: "58908592" } }] },
    select: { id: true, date: true, amount: true, description: true },
  });
  // José Pérez $766.650 sin_asignar
  const jp = await prisma.bankMovement.findMany({
    where: { bankAccountId: "ba_op_blarq", status: "sin_asignar", amount: -766650, counterpartyRut: { contains: "54987177" } },
    select: { id: true, date: true, amount: true, description: true },
  });
  // Iván Henríquez $800.000 interno
  const ivan = await prisma.bankMovement.findFirst({
    where: { bankAccountId: "ba_op_blarq", status: "interno", amount: -800000, counterpartyRut: { contains: "16770296" } },
    select: { id: true, date: true, amount: true, description: true, internalTransferToId: true },
  });

  const movs = [...pb, ...jp, ...(ivan ? [ivan] : [])];
  const sumPagos = movs.reduce((s, m) => s + Math.abs(m.amount), 0);
  console.log(`\nMovimientos a conciliar a JPB f173: ${movs.length} (esperado 16)`);
  console.log(`  Pedro Barrera: ${pb.length} (${fmt(pb.reduce((s, m) => s + Math.abs(m.amount), 0))})`);
  console.log(`  José Pérez:    ${jp.length} (${fmt(jp.reduce((s, m) => s + Math.abs(m.amount), 0))})`);
  console.log(`  Iván Henríquez:${ivan ? " 1 (" + fmt(Math.abs(ivan.amount)) + ", sale de interno)" : " 0 (no encontrado!)"}`);
  console.log(`  SUMA: ${fmt(sumPagos)} → saldo resultante ${fmt(f173.totalAmount - sumPagos)}`);

  // candados de seguridad
  if (movs.length !== 16) { console.log(`\nABORTO: esperaba 16 movimientos, encontré ${movs.length}. Revisar a mano.`); await prisma.$disconnect(); return; }
  if (sumPagos > f173.totalAmount) { console.log(`\nABORTO: la suma (${fmt(sumPagos)}) supera el total de la factura. Revisar.`); await prisma.$disconnect(); return; }

  if (!APPLY) {
    console.log(`\nDetalle:`);
    for (const m of movs) console.log(`   ${m.date.toISOString().slice(0, 10)} ${fmt(Math.abs(m.amount)).padStart(11)}  ${m.description.slice(0, 34)}`);
    console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`);
    await prisma.$disconnect(); return;
  }

  // ── aplicar ──
  // 1. desemparejar el traspaso interno de Iván (él + su contraparte)
  if (ivan?.internalTransferToId) {
    await prisma.bankMovement.update({ where: { id: ivan.internalTransferToId }, data: { status: "sin_asignar", internalTransferToId: null } });
    await prisma.bankMovement.update({ where: { id: ivan.id }, data: { internalTransferToId: null } });
    console.log(`Desemparejado el interno: contraparte "${"Transf de BLARQ SPA"}" → sin_asignar.`);
  }
  // 2. crear los pagos (manual) e ir conciliando los movimientos
  let creados = 0;
  for (const m of movs) {
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: m.id, invoiceId: f173.id } });
    if (!exists) { await prisma.invoicePayment.create({ data: { bankMovementId: m.id, invoiceId: f173.id, amountApplied: Math.abs(m.amount), autoMatched: false } }); creados++; }
    await prisma.bankMovement.update({ where: { id: m.id }, data: { status: "conciliado" } });
  }
  await recomputeInvoiceStatus(f173.id);
  console.log(`\nEscritos: ${creados} pagos creados, ${movs.length} movimientos → conciliado.`);

  // ── verificación ──
  const after = await prisma.invoice.findUnique({ where: { id: f173.id }, select: { status: true, totalAmount: true, payments: { select: { amountApplied: true } } } });
  const paid = after!.payments.reduce((s, p) => s + p.amountApplied, 0);
  console.log(`JPB f173 ahora: [${after!.status}] pagado ${fmt(paid)} · saldo ${fmt(after!.totalAmount - paid)} (Maxxa: pagado $4.501.650, saldo $300.000)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
