// Alinea el ESTADO de las NC que ya están compensadas por dentro pero les
// quedó el status en "pendiente".
//
// Una NC con compensationType lleno (other_invoice / cash_refund / bank_refund)
// es un crédito YA RESUELTO: se aplicó a otra factura, volvió en efectivo, o
// volvió al banco. En todos esos casos su estado correcto es "aplicada"
// (status="pagada", la misma etiqueta que usa el resto de las NC resueltas).
// Algunas quedaron en "pendiente" por datos legacy → aparecen como deuda/crédito
// sin resolver cuando en realidad ya están cerradas. Caso real: NC 5 emitida
// (Industrial y Comercial Pite, obra Rosas) que anuló la factura 165.
//
// NO mueve el gasto por obra: metrics.ts netea la NC por tipoDoc=61 sin mirar
// su status → Δ$0 (se verifica antes/después).
//
// CANDADOS:
//   - Solo prod (ep-shy-morning), aborta si no.
//   - Dry-run por default; escribe solo con --apply.
//   - Solo toca NC (tipoDoc=61) con status="pendiente" Y compensationType != null.
//     (Las NC de reembolso que MJ dejó SIN clasificar a propósito tienen
//      compensationType=null → NO entran. Ver fix-nc-anuladas-pagadas.ts.)
//   - Solo cambia status (→ "pagada") + paidAt. No toca montos, vínculos ni type.
//   - Backup JSON del estado ANTES (solo en --apply).
//
// Uso:
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/fix-nc-compensada-pendiente.ts
//   ...mismo con --apply para escribir.

import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/ep-shy-morning/.test(url)) {
    console.error("ABORTA: DATABASE_URL no apunta a PROD (ep-shy-morning).");
    process.exit(1);
  }
  console.log(`Entorno: PROD | modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // Gasto recibidas neto (con signo NC) ANTES — para confirmar Δ$0.
  const sign = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  const recAntes = await prisma.invoice.findMany({
    where: { type: "recibida" },
    select: { tipoDoc: true, netAmount: true },
  });
  const gastoAntes = recAntes.reduce((s, i) => s + sign(i) * i.netAmount, 0);

  // Candidatas: NC compensada por dentro pero status pendiente.
  const ncs = await prisma.invoice.findMany({
    where: {
      tipoDoc: 61,
      status: "pendiente",
      compensationType: { not: null },
    },
    select: {
      id: true, type: true, folioNumber: true, businessName: true,
      totalAmount: true, compensationType: true, appliedToInvoiceId: true,
      refundBankMovementId: true, referenceFolioNumber: true,
    },
  });

  console.log(`NC a corregir (pendiente → aplicada/pagada): ${ncs.length}\n`);
  for (const n of ncs) {
    let tgt = "";
    if (n.appliedToInvoiceId) {
      const t = await prisma.invoice.findUnique({
        where: { id: n.appliedToInvoiceId },
        select: { folioNumber: true, status: true },
      });
      if (t) tgt = ` → factura f${t.folioNumber} [${t.status}]`;
    } else if (n.refundBankMovementId) {
      tgt = ` → reembolso al banco`;
    }
    console.log(
      `  ${n.type} NC f${n.folioNumber} ${(n.businessName ?? "").slice(0, 26).padEnd(26)} ` +
        `${clp(Math.abs(n.totalAmount)).padStart(12)}  comp=${n.compensationType}${tgt}`
    );
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Para aplicar: --apply`);
    console.log(`Gasto recibidas actual: ${clp(gastoAntes)} (no cambia: el status no afecta metrics).`);
    await prisma.$disconnect();
    return;
  }

  const backupPath = `backups/fix-nc-compensada-pendiente-backup.json`;
  writeFileSync(backupPath, JSON.stringify({ fecha: new Date().toISOString(), ncs }, null, 2));
  console.log(`\nBackup escrito: ${backupPath}`);

  for (const n of ncs) {
    await prisma.invoice.update({
      where: { id: n.id },
      data: { status: "pagada", paidAt: new Date() },
    });
  }

  const recDespues = await prisma.invoice.findMany({
    where: { type: "recibida" },
    select: { tipoDoc: true, netAmount: true },
  });
  const gastoDespues = recDespues.reduce((s, i) => s + sign(i) * i.netAmount, 0);
  console.log(`\nAPLICADO: ${ncs.length} NC → "pagada" (aplicada).`);
  console.log(
    `Gasto recibidas ANTES ${clp(gastoAntes)} · DESPUÉS ${clp(gastoDespues)} · Δ ${clp(gastoDespues - gastoAntes)}`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
