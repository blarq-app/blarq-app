/**
 * Prueba de punta a punta del camino que ESCRIBE, contra la base de DEV.
 *
 * Toma una propuesta "segura", la aplica con la misma función que usa el
 * botón "Conciliar las N tildadas" (applyAutoMatchPayment), verifica que el
 * movimiento y la factura queden como corresponde, y DESHACE todo — así la
 * base de dev queda igual que como estaba.
 *
 * Es la prueba de que el gesto nuevo mueve la plata exactamente como el
 * auto-match de siempre: mismo pago, mismo estado, mismo recálculo.
 *
 * Uso:  npx tsx scripts/verify-conciliar-aplicar.ts
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  proposeMovementInvoiceMatch,
  applyAutoMatchPayment,
  recomputeInvoiceStatus,
  loadReembolsadores,
  loadCandidateInvoices,
} from "../src/lib/banco/invoicePayments";

config({ path: ".env", override: true });
const prisma = new PrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/ep-[a-z]+-[a-z]+/)?.[0];
  console.log(`Base: ${host ?? "?"}`);
  if (host !== "ep-solitary-mud") {
    console.log("Solo corre contra dev. Abortando.");
    return;
  }

  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      description: true,
      counterpartyRut: true,
      counterpartyName: true,
      date: true,
      category: true,
      payments: { select: { id: true } },
    },
  });

  const reembolsadores = await loadReembolsadores();
  const invoices = await loadCandidateInvoices();

  // Buscamos la primera propuesta segura.
  let elegido: { mov: (typeof movs)[number]; invoiceId: string } | null = null;
  for (const mov of movs) {
    const p = await proposeMovementInvoiceMatch(mov, reembolsadores, {
      invoices,
      excludeInvoiceIds: new Set(),
    });
    if (p.confianza === "segura" && p.invoiceId) {
      elegido = { mov, invoiceId: p.invoiceId };
      break;
    }
  }
  if (!elegido) {
    console.log("No hay ninguna propuesta segura en dev — nada que probar.");
    return;
  }

  const { mov, invoiceId } = elegido;
  const antesMov = await prisma.bankMovement.findUnique({
    where: { id: mov.id },
    select: { status: true, category: true },
  });
  const antesInv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, folioNumber: true, businessName: true, totalAmount: true },
  });
  const pagosAntes = await prisma.invoicePayment.count();

  console.log(`\nMovimiento: ${mov.description.slice(0, 50)} · $${Math.round(mov.amount).toLocaleString("es-CL")}`);
  console.log(`  antes  → estado "${antesMov?.status}" · categoría ${antesMov?.category ?? "(ninguna)"}`);
  console.log(`Factura:  F-${antesInv?.folioNumber} · ${antesInv?.businessName}`);
  console.log(`  antes  → estado "${antesInv?.status}"`);

  // ── APLICAR (lo mismo que hace el botón con las tildadas) ──────────────
  await applyAutoMatchPayment(mov, invoiceId);

  const despuesMov = await prisma.bankMovement.findUnique({
    where: { id: mov.id },
    select: { status: true, category: true },
  });
  const despuesInv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  const pago = await prisma.invoicePayment.findFirst({
    where: { bankMovementId: mov.id, invoiceId },
    select: { id: true, amountApplied: true, autoMatched: true },
  });

  console.log(`\n── Después de conciliar ──`);
  console.log(`  movimiento → "${despuesMov?.status}" · categoría ${despuesMov?.category ?? "(ninguna)"}`);
  console.log(`  factura    → "${despuesInv?.status}"`);
  console.log(
    `  pago creado: $${Math.round(pago?.amountApplied ?? 0).toLocaleString("es-CL")} · autoMatched=${pago?.autoMatched}`
  );

  const ok =
    despuesMov?.status === "conciliado" &&
    pago != null &&
    pago.autoMatched === true &&
    Math.round(pago.amountApplied) === Math.round(Math.abs(mov.amount));
  console.log(`  ${ok ? "OK — quedó como el auto-match de siempre" : "MAL — revisar"}`);

  // ── DESHACER (dejar dev como estaba) ───────────────────────────────────
  if (pago) await prisma.invoicePayment.delete({ where: { id: pago.id } });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: antesMov!.status, category: antesMov!.category },
  });
  await recomputeInvoiceStatus(invoiceId);

  const finMov = await prisma.bankMovement.findUnique({
    where: { id: mov.id },
    select: { status: true, category: true },
  });
  const finInv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  const pagosFin = await prisma.invoicePayment.count();

  console.log(`\n── Deshecho (dev vuelve a como estaba) ──`);
  console.log(`  movimiento → "${finMov?.status}" · categoría ${finMov?.category ?? "(ninguna)"}`);
  console.log(`  factura    → "${finInv?.status}"`);
  console.log(`  pagos: ${pagosAntes} antes · ${pagosFin} ahora`);
  const restaurado =
    finMov?.status === antesMov?.status &&
    finMov?.category === antesMov?.category &&
    finInv?.status === antesInv?.status &&
    pagosFin === pagosAntes;
  console.log(`  ${restaurado ? "RESTAURADO — dev quedó idéntico" : "OJO: dev NO quedó igual"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
