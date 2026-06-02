// Despega los pagos que están MAL pegados a una venta (factura emitida).
//
// Error de la migración automática (choque de folio): un movimiento que es un
// CARGO (plata que SALIÓ de la cuenta, un pago a un proveedor) quedó imputado a
// una factura EMITIDA (una venta a un cliente). Eso es imposible: una venta la
// paga el cliente con plata que ENTRA, no BLARQ con plata que sale.
//
// Acción (lo único OBVIO y seguro): borrar ese InvoicePayment y devolver el
// movimiento a "sin_asignar" para que MJ lo reasigne a mano a la compra real.
// NO reengancha a ninguna compra (el reparto por movimiento no es obvio → MJ).
// La venta vuelve sola a "pendiente" (recomputeInvoiceStatus).
//
// NO mueve los números de ninguna obra: cobrado/gastado salen de las facturas,
// no de los pagos (metrics.ts). Es solo trazabilidad. Reversible.
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/despegar-pagos-en-ventas.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const env = /ep-shy-morning/.test(url) ? "prod" : "otro";
  const host = url.match(/@([^/?]+)/)?.[1] ?? "—";
  console.log(`despegar-pagos-en-ventas — ${APPLY ? "APPLY" : "DRY-RUN"} | ${env} | ${host}\n`);
  if (env !== "prod") { console.log("No reconozco prod (ep-shy-morning). Aborto."); await prisma.$disconnect(); return; }

  // pagos cuyo movimiento es un CARGO (amount < 0) pero la factura es una VENTA (emitida)
  const pagos = await prisma.invoicePayment.findMany({
    select: {
      id: true, amountApplied: true,
      bankMovement: { select: { id: true, amount: true, description: true, date: true, status: true } },
      invoice: { select: { id: true, type: true, folioNumber: true, businessName: true, status: true } },
    },
  });
  const malos = pagos.filter((p) => p.bankMovement && p.invoice && p.bankMovement.amount < 0 && p.invoice.type === "emitida");

  console.log(`Pagos a despegar (cargo pegado a una venta): ${malos.length}\n`);
  for (const p of malos) {
    console.log(
      `  ${p.bankMovement!.date.toISOString().slice(0, 10)}  ${fmt(p.amountApplied).padStart(12)}  ` +
      `mov[${p.bankMovement!.status}] "${p.bankMovement!.description.slice(0, 30)}"  →  ` +
      `venta f${String(p.invoice!.folioNumber).replace(/^0+/, "")} ${(p.invoice!.businessName ?? "").slice(0, 24)} [${p.invoice!.status}]`
    );
  }

  const ventasAfectadas = [...new Set(malos.map((p) => p.invoice!.id))];
  // movimientos a devolver a sin_asignar: solo los que hoy figuran "linkeados"
  // (conciliado/parcial). Los que ya están sin_asignar o sin_factura se dejan.
  const movsADesligar = [...new Set(
    malos.filter((p) => ["conciliado", "parcial"].includes(p.bankMovement!.status)).map((p) => p.bankMovement!.id)
  )];
  console.log(`\nVentas que volverán a 'pendiente': ${ventasAfectadas.length}`);
  console.log(`Movimientos conciliado/parcial → sin_asignar: ${movsADesligar.length} (los que ya estaban sin_asignar/sin_factura no se tocan)`);

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  let borrados = 0;
  for (const p of malos) { await prisma.invoicePayment.delete({ where: { id: p.id } }); borrados++; }
  for (const movId of movsADesligar) await prisma.bankMovement.update({ where: { id: movId }, data: { status: "sin_asignar" } });
  for (const invId of ventasAfectadas) await recomputeInvoiceStatus(invId);
  console.log(`\nEscritos: ${borrados} pagos borrados, ${movsADesligar.length} movs → sin_asignar, ${ventasAfectadas.length} ventas recalculadas.`);

  // ── verificación ──
  const quedan = (await prisma.invoicePayment.findMany({
    select: { bankMovement: { select: { amount: true } }, invoice: { select: { type: true } } },
  })).filter((p) => p.bankMovement && p.invoice && p.bankMovement.amount < 0 && p.invoice.type === "emitida").length;
  console.log(`Verificación — pagos 'cargo pegado a venta' restantes (debe ser 0): ${quedan}`);
  const ventas = await prisma.invoice.findMany({ where: { id: { in: ventasAfectadas } }, select: { folioNumber: true, status: true } });
  console.log("Estado de las ventas afectadas: " + ventas.map((v) => `f${String(v.folioNumber).replace(/^0+/, "")}=${v.status}`).join(", "));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
