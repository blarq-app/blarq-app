// Concilia el cargo de tarjeta "Compra ERPYME" $-43.115 (28-may-2026, cta
// Operativa) con su factura real: MAXXA SOFTWARE SPA folio 88607, 10-may-2026,
// $43.115 (monto exacto). "ERPYME" es la suscripción mensual a MAXXA — los 17
// cargos anteriores están todos conciliados contra facturas del mismo RUT
// (76770943-9). Candidato único de cada lado. Confirmado con MJ (2026-06-02).
//
// Uso (DRY-RUN):  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-erpyme-maxxa-may2026.ts
// Uso (APLICAR):  ...mismo... scripts/conciliar-erpyme-maxxa-may2026.ts --apply

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const MOV_ID = "cmpx60ckm0015lb04nxmc7efp"; // Compra ERPYME -43115 28-may-2026
const INV_ID = "cmp1g226g0002gz04iesdndwh"; // MAXXA folio 88607 43115
const MONTO = 43115;

// recompute idéntico a recomputeInvoiceStatus (lib/banco/invoicePayments.ts).
async function recompute(id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { totalAmount: true, status: true } });
  if (!inv || inv.status === "anulada") return;
  const ps = await prisma.invoicePayment.findMany({
    where: { invoiceId: id },
    select: { amountApplied: true, bankMovement: { select: { date: true } } },
  });
  const sum = ps.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;
  if (sum >= inv.totalAmount - 1) {
    status = "pagada";
    paidAt = ps.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null);
  } else if (sum > 0) status = "parcial";
  await prisma.invoice.update({ where: { id }, data: { status, paidAt } });
}

async function main() {
  // Guard: solo prod (ep-shy-morning). Evita escribir por error en dev.
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) {
    console.log("No reconozco prod (falta ep-shy-morning en DATABASE_URL). Aborto.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}`);

  // Releer ambos lados y validar el estado esperado antes de tocar nada.
  const mov = await prisma.bankMovement.findUnique({
    where: { id: MOV_ID },
    include: { payments: true, bankAccount: { select: { alias: true } } },
  });
  const inv = await prisma.invoice.findUnique({
    where: { id: INV_ID },
    include: { payments: true },
  });
  if (!mov || !inv) { console.log("No encuentro mov o factura. Aborto."); await prisma.$disconnect(); return; }

  console.log("Movimiento:", { cuenta: mov.bankAccount.alias, fecha: mov.date.toISOString().slice(0,10), amount: mov.amount, status: mov.status, glosa: mov.description, pagos: mov.payments.length });
  console.log("Factura:   ", { proveedor: inv.businessName, rut: inv.rutIssuer, folio: inv.folioNumber, total: inv.totalAmount, status: inv.status, pagos: inv.payments.length });

  // Chequeos de seguridad: montos calzan, sin pagos previos.
  const problemas: string[] = [];
  if (Math.abs(mov.amount) !== MONTO) problemas.push(`mov.amount=${mov.amount} != -${MONTO}`);
  if (inv.totalAmount !== MONTO) problemas.push(`inv.total=${inv.totalAmount} != ${MONTO}`);
  if (mov.payments.length > 0) problemas.push("el movimiento ya tiene pagos");
  if (inv.payments.length > 0) problemas.push("la factura ya tiene pagos");
  const dup = await prisma.invoicePayment.findFirst({ where: { bankMovementId: MOV_ID, invoiceId: INV_ID } });
  if (dup) problemas.push("ya existe la imputación (idempotente)");
  if (problemas.length) { console.log("\nNO APLICO. Motivos:\n - " + problemas.join("\n - ")); await prisma.$disconnect(); return; }

  console.log(`\nAcción: crear InvoicePayment $${MONTO} → factura queda pagada, movimiento queda conciliado.`);

  if (!APPLY) { console.log("\nDRY-RUN. Pasar --apply para escribir."); await prisma.$disconnect(); return; }

  await prisma.$transaction([
    prisma.invoicePayment.create({ data: { bankMovementId: MOV_ID, invoiceId: INV_ID, amountApplied: MONTO } }),
    prisma.bankMovement.update({ where: { id: MOV_ID }, data: { status: "conciliado" } }),
  ]);
  await recompute(INV_ID);
  const after = await prisma.invoice.findUnique({ where: { id: INV_ID }, select: { status: true, paidAt: true } });
  console.log("LISTO. Factura ->", after?.status, "paidAt:", after?.paidAt?.toISOString().slice(0,10));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
