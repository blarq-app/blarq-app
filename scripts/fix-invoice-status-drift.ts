/**
 * Corrige facturas cuyo `status` quedó atrasado respecto a los pagos
 * (InvoicePayment) realmente linkeados. Caso tipico: la migracion legacy
 * `replicate-invoice-payments-dev-to-prod.ts` creó los InvoicePayment pero
 * no llamó a recomputeInvoiceStatus, dejando facturas con plata imputada
 * al 100% pero estado "pendiente".
 *
 * SOLO sube el estado (pendiente→parcial→pagada) cuando hay pago real
 * linkeado. NUNCA baja una "pagada" a "pendiente" — eso protegería las
 * facturas legacy marcadas pagada a mano sin link (que estan bien asi).
 *
 * Uso:
 *   npx tsx scripts/fix-invoice-status-drift.ts          # dry-run
 *   npx tsx scripts/fix-invoice-status-drift.ts --apply  # escribe
 *   DATABASE_URL="<prod>" npx tsx scripts/fix-invoice-status-drift.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const f = (n: number) => "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
const RANK: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };

async function main() {
  const facs = await prisma.invoice.findMany({
    where: { tipoDoc: { not: 61 } },
    select: {
      id: true, folioNumber: true, businessName: true, totalAmount: true,
      status: true, payments: { select: { amountApplied: true } },
    },
  });

  const toFix = facs.filter((fa) => {
    if (fa.status === "anulada") return false;
    const paid = fa.payments.reduce((s, p) => s + p.amountApplied, 0);
    if (paid <= 0) return false; // sin pago real → no tocar
    let should = "pendiente";
    if (paid >= fa.totalAmount - 1) should = "pagada";
    else if (paid > 0) should = "parcial";
    return RANK[fa.status] < RANK[should]; // solo subir
  });

  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Facturas a corregir: ${toFix.length}\n`);
  for (const fa of toFix) {
    const paid = fa.payments.reduce((s, p) => s + p.amountApplied, 0);
    let should = "pendiente";
    if (paid >= fa.totalAmount - 1) should = "pagada";
    else if (paid > 0) should = "parcial";
    console.log(`  F-${(fa.folioNumber ?? "").padStart(5)} | ${(fa.businessName ?? "").slice(0,26).padEnd(26)} | ${fa.status} → ${should} | pagado ${f(paid)}`);
  }

  if (!APPLY) {
    console.log("\nDry-run. Corré con --apply para escribir.");
    return;
  }
  console.log("\nAplicando recomputeInvoiceStatus...");
  for (const fa of toFix) await recomputeInvoiceStatus(fa.id);
  console.log(`Listo. ${toFix.length} facturas recalculadas.`);
}
main().finally(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
