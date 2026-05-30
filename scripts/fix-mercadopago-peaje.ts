// Suelta la conciliación errónea: "Compra MERCADOPAGO *MERC" $10.959 (16-mar)
// estaba pegada a F-10001280 (peaje, Concesionaria Vespucio Norte) emitida 21
// días después. Confirmado con MJ. El mov vuelve a sin_asignar; la factura de
// peaje vuelve a pendiente (espera su PAC real).
//
// Dry-run por defecto. --apply para escribir.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const PAY_ID = "cmop1vyrg003vrtv9b6v7zoc0";
const MOV_ID = "cmokugthj005rrt9a4j45kwic";
const INV_ID = "cmoj21dri0035rt1glzh5eie1";

async function recompute(id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { totalAmount: true, status: true } });
  if (!inv || inv.status === "anulada") return;
  const ps = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, select: { amountApplied: true, bankMovement: { select: { date: true } } } });
  const sum = ps.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;
  if (sum >= inv.totalAmount - 1) { status = "pagada"; paidAt = ps.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null); }
  else if (sum > 0) status = "parcial";
  await prisma.invoice.update({ where: { id }, data: { status, paidAt } });
}

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const p = await prisma.invoicePayment.findUnique({ where: { id: PAY_ID }, select: { invoiceId: true } });
  if (!p) { console.log("Pago ya no existe — OMITIDO"); await prisma.$disconnect(); return; }
  if (p.invoiceId !== INV_ID) { console.log("El pago ya no apunta a F-10001280 — OMITIDO"); await prisma.$disconnect(); return; }
  console.log("Soltar pago $10.959 → F-10001280 (peaje) vuelve a pendiente");
  if (APPLY) {
    await prisma.$transaction([
      prisma.invoicePayment.delete({ where: { id: PAY_ID } }),
      prisma.bankMovement.update({ where: { id: MOV_ID }, data: { status: "sin_asignar" } }),
    ]);
    await recompute(INV_ID);
    console.log("LISTO.");
  } else console.log("DRY-RUN. --apply para aplicar.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
