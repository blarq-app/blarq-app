// Concilia el mov MercadoPago $39.990 (2026-02-17, "*NEWE") con su factura real
// F-12254760 (MercadoLibre Chile, CASA). Match exacto de monto y mismo día.
// Confirmado con MJ (2026-05-30). Dry-run por defecto; --apply para escribir.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const MOV_ID = "cmothjbls00c1rtkv1wd401e2";
const INV_ID = "cmok24i30005mrtsicc14z4tt";
const MONTO = 39990;

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
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const dup = await prisma.invoicePayment.findFirst({ where: { bankMovementId: MOV_ID, invoiceId: INV_ID } });
  if (dup) { console.log("Ya existe la imputación — OMITIDO"); await prisma.$disconnect(); return; }
  console.log("Conciliar $39.990 → F-12254760 (MercadoLibre) → queda pagada");
  if (APPLY) {
    await prisma.$transaction([
      prisma.invoicePayment.create({ data: { bankMovementId: MOV_ID, invoiceId: INV_ID, amountApplied: MONTO } }),
      prisma.bankMovement.update({ where: { id: MOV_ID }, data: { status: "conciliado" } }),
    ]);
    await recompute(INV_ID);
    console.log("LISTO.");
  } else console.log("DRY-RUN. --apply para aplicar.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
