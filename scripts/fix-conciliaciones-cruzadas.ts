// Arregla conciliaciones mal asignadas detectadas el 2026-05-30.
//
// (1) Tres PARES CRUZADOS: dos movimientos del mismo monto cuyas facturas
//     quedaron intercambiadas (el mov de Easy pegado a la factura de Cavem y
//     viceversa, etc.). Se intercambian las facturas de cada par → cada mov
//     queda en la factura de su mismo proveedor y mismo día (gap 0).
//
// (2) COMERCIAL K $4.990 (09-jun-2025): pegado a una factura de MercadoLibre
//     emitida 8 meses DESPUÉS del pago. No existe ninguna factura de Comercial
//     K por ese monto → se DESASIGNA (borra el pago, mov → sin_asignar) y la
//     factura de MercadoLibre vuelve a "pendiente" hasta encontrar su pago real.
//
// Dry-run por defecto. Escribe solo con --apply.
// Uso (PROD):
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" \
//     npx tsx scripts/fix-conciliaciones-cruzadas.ts [--apply]

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);

// ── Recalcula status/paidAt de una factura (replica src/lib/banco/invoicePayments.ts)
async function recomputeInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, status: true },
  });
  if (!invoice || invoice.status === "anulada") return;
  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId },
    select: { amountApplied: true, bankMovement: { select: { date: true } } },
  });
  const sum = payments.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;
  if (sum >= invoice.totalAmount - 1) {
    status = "pagada";
    paidAt = payments.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null);
  } else if (sum > 0) status = "parcial";
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status, paidAt } });
}

// payA y payB deben estar HOY cruzados: payA→invForB, payB→invForA.
// Los reapunta: payA→invForA, payB→invForB.
type Swap = { label: string; payA: string; payB: string; invForA: string; invForB: string };
const SWAPS: Swap[] = [
  { label: "PAR A · Easy↔Cavem $6.990",
    payA: "cmop1vyr4002zrtv9jlkd7g4f", invForA: "cmok24hwc002hrtsiu36zeda8",   // mov Easy 03-11 → factura Easy F-37626898
    payB: "cmou29etf000prtabiffh2one", invForB: "cmok24i9g009ertsic6mg2r9b" }, // mov Cavem 01-09 → factura Cavem F-159463
  { label: "PAR B · Easy↔Sodimac ~$42.777",
    payA: "cmop1vyra003frtv9mqoyjjo3", invForA: "cmok24hvc001zrtsifmtrpkye",   // mov Easy 03-13 → factura Easy F-37637860
    payB: "cmop1vyty009xrtv9wdqrjwc3", invForB: "cmoj21dln001crt1gyrm1wn19" }, // mov Sodimac 04-21 → factura Sodimac F-146772634
  { label: "PAR C · Cavem↔Sodimac ~$22.700",
    payA: "cmop1vyq5000hrtv9c7h24llw", invForA: "cmok24hyj003qrtsi2hkmh49w",   // mov Cavem 03-03 → factura Cavem F-162523
    payB: "cmop1vyrw004zrtv9gtoqz0tb", invForB: "cmok24htt0015rtsi0mutna2m" }, // mov Sodimac 03-20 → factura Sodimac F-146105179
];

// Comercial K: desasignar (no existe factura correcta del proveedor).
const UNLINK = {
  label: "COMERCIAL K $4.990 (09-jun-2025)",
  payId: "cmp94xvw00001jx04b6z1m1ht",
  movId: "cmp8i5e6k00j3l104szvklurz",
  invId: "cmok24hze0048rtsiigeodjrw", // MercadoLibre F-12360404
};

async function loadPay(id: string) {
  return prisma.invoicePayment.findUnique({
    where: { id },
    select: {
      id: true, amountApplied: true, invoiceId: true,
      bankMovement: { select: { id: true, date: true, description: true, amount: true } },
      invoice: { select: { id: true, folioNumber: true, businessName: true, issueDate: true, totalAmount: true } },
    },
  });
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—";
  console.log(`Host: ${host}`);
  console.log(`Modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}\n`);

  const invoicesToRecompute = new Set<string>();
  let abort = false;

  // ── Verificación + plan de los swaps ────────────────────────────────────
  for (const s of SWAPS) {
    console.log(`### ${s.label}`);
    const a = await loadPay(s.payA);
    const b = await loadPay(s.payB);
    if (!a || !b) { console.log("  ⚠️  pago no encontrado — ABORTO este par\n"); abort = true; continue; }

    // Guard: hoy deben estar cruzados (payA apunta a invForB, payB a invForA).
    const crossedOk = a.invoiceId === s.invForB && b.invoiceId === s.invForA;
    if (!crossedOk) {
      console.log(`  ⚠️  estado actual NO es el esperado (¿ya arreglado?) — ABORTO este par`);
      console.log(`     payA→${a.invoice?.folioNumber} payB→${b.invoice?.folioNumber}\n`);
      abort = true; continue;
    }
    const tgtA = await prisma.invoice.findUnique({ where: { id: s.invForA }, select: { folioNumber: true, businessName: true, issueDate: true } });
    const tgtB = await prisma.invoice.findUnique({ where: { id: s.invForB }, select: { folioNumber: true, businessName: true, issueDate: true } });
    console.log(`  mov ${d(a.bankMovement.date)} ${f(a.bankMovement.amount)} "${a.bankMovement.description.slice(0,22)}"`);
    console.log(`     ahora→ F-${a.invoice?.folioNumber} ${a.invoice?.businessName} (${d(a.invoice!.issueDate)})`);
    console.log(`     queda→ F-${tgtA?.folioNumber} ${tgtA?.businessName} (${d(tgtA!.issueDate)})`);
    console.log(`  mov ${d(b.bankMovement.date)} ${f(b.bankMovement.amount)} "${b.bankMovement.description.slice(0,22)}"`);
    console.log(`     ahora→ F-${b.invoice?.folioNumber} ${b.invoice?.businessName} (${d(b.invoice!.issueDate)})`);
    console.log(`     queda→ F-${tgtB?.folioNumber} ${tgtB?.businessName} (${d(tgtB!.issueDate)})`);
    console.log("");

    if (APPLY) {
      await prisma.$transaction([
        prisma.invoicePayment.update({ where: { id: s.payA }, data: { invoiceId: s.invForA } }),
        prisma.invoicePayment.update({ where: { id: s.payB }, data: { invoiceId: s.invForB } }),
      ]);
    }
    [s.invForA, s.invForB, a.invoiceId, b.invoiceId].forEach((i) => invoicesToRecompute.add(i));
  }

  // ── Verificación + plan del unlink (Comercial K) ────────────────────────
  console.log(`### ${UNLINK.label}`);
  const up = await loadPay(UNLINK.payId);
  if (!up) {
    console.log("  ⚠️  pago no encontrado (¿ya desasignado?) — se omite\n");
  } else if (up.invoiceId !== UNLINK.invId || up.bankMovement.id !== UNLINK.movId) {
    console.log("  ⚠️  estado actual NO es el esperado — ABORTO el unlink\n");
    abort = true;
  } else {
    console.log(`  mov ${d(up.bankMovement.date)} ${f(up.bankMovement.amount)} "${up.bankMovement.description}"`);
    console.log(`     ahora→ F-${up.invoice?.folioNumber} ${up.invoice?.businessName} (${d(up.invoice!.issueDate)})  [pago 8 meses anterior a la factura]`);
    console.log(`     queda→ SIN factura (mov → sin_asignar; F-${up.invoice?.folioNumber} vuelve a 'pendiente')\n`);
    if (APPLY) {
      await prisma.$transaction([
        prisma.invoicePayment.delete({ where: { id: UNLINK.payId } }),
        prisma.bankMovement.update({ where: { id: UNLINK.movId }, data: { status: "sin_asignar" } }),
      ]);
    }
    invoicesToRecompute.add(UNLINK.invId);
  }

  if (APPLY) {
    for (const id of invoicesToRecompute) await recomputeInvoiceStatus(id);
    console.log(`Recalculado status de ${invoicesToRecompute.size} facturas.`);
    console.log("LISTO — cambios aplicados.");
  } else {
    console.log(abort
      ? "DRY-RUN con AVISOS arriba — revisar antes de aplicar."
      : "DRY-RUN ok. Para aplicar: agregá --apply.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
