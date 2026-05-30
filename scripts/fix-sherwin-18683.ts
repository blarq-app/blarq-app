// Mueve el pago de la compra Sherwin del 23-mar-2026 ($18.683) desde la
// factura del 06-mar (F-2963377) a la del MISMO día 23-mar (F-2974064).
// Confirmado con MJ: el pago del 23-mar estaba mal pegado a la factura del 06.
//
// Dry-run por defecto. Escribe con --apply.
// Uso (PROD):
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" \
//     npx tsx scripts/fix-sherwin-18683.ts [--apply]

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const PAY_ID = "cmop1vys2005hrtv9u1is3uks";
const FROM_INV = "cmok24hxb0031rtsijfi028nr"; // F-2963377 (06-mar)
const TO_INV = "cmok24ht6000srtsi20bvcj09";   // F-2974064 (23-mar)

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
  console.log(`Host: ${(process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—"}`);
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const pay = await prisma.invoicePayment.findUnique({
    where: { id: PAY_ID },
    select: { amountApplied: true, invoiceId: true, bankMovement: { select: { date: true, description: true } } },
  });
  if (!pay) { console.log("Pago no encontrado — abort."); await prisma.$disconnect(); return; }
  if (pay.invoiceId !== FROM_INV) {
    console.log(`El pago ya NO está en F-2963377 (¿ya movido?). Apunta a invId ${pay.invoiceId}. Abort.`);
    await prisma.$disconnect(); return;
  }
  console.log(`Pago ${f(pay.amountApplied)} | mov ${pay.bankMovement.date.toISOString().slice(0,10)} "${pay.bankMovement.description}"`);
  console.log(`  de  F-2963377 (06-mar) → queda pendiente`);
  console.log(`  a   F-2974064 (23-mar) → queda pagada\n`);

  if (APPLY) {
    await prisma.invoicePayment.update({ where: { id: PAY_ID }, data: { invoiceId: TO_INV } });
    await recompute(FROM_INV);
    await recompute(TO_INV);
    console.log("LISTO — aplicado.");
  } else {
    console.log("DRY-RUN ok. Para aplicar: --apply");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
