// Corrige las facturas que están en "anulada" pero en realidad estaban
// PAGADAS enteras por el banco antes de que llegara una NC (devolución).
// Bajo la regla nueva, esas facturas deben quedar "pagada".
//
// Candados:
//   - Solo prod (ep-shy-morning), aborta si no.
//   - Dry-run por default; escribe solo con --apply.
//   - Solo toca facturas que cumplen LAS TRES: status="anulada",
//     pagada entera por banco (realPaid >= total − $10) y con al menos
//     una NC que las referencia.
//   - Solo cambia el campo `status` (anulada → pagada). NO toca montos,
//     tipoDoc ni type → el gasto del proyecto es idéntico (Δ$0).
//   - Backup JSON del estado ANTES (solo en --apply).
//
// Además, deja las NC de esas facturas SIN CLASIFICAR: les quita
// compensationType="other_invoice" + appliedToInvoiceId y las vuelve a
// status="pendiente" (conservando referenceFolioNumber). Así aparecen en la
// barra de "saldo a favor" para que MJ diga si volvió en efectivo o al banco.
// Esto NO mueve el gasto: la NC ya resta sola en metrics.ts por tipoDoc=61,
// sin importar su compensationType. (Decisión MJ.)

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const url = process.env.DATABASE_URL ?? "";
if (!/ep-shy-morning/.test(url)) {
  console.error("ABORTA: DATABASE_URL no apunta a PROD (ep-shy-morning).");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const TOL = 10;
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log(
    `Entorno: PROD (ep-shy-morning) | modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`
  );

  // Gasto total recibidas (neto, con signo NC) ANTES — para confirmar Δ$0.
  const recibidas = await prisma.invoice.findMany({
    where: { type: "recibida" },
    select: { tipoDoc: true, netAmount: true },
  });
  const sign = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  const gastoAntes = recibidas.reduce((s, i) => s + sign(i) * i.netAmount, 0);

  // Candidatas: anuladas pagadas enteras por banco.
  const anuladas = await prisma.invoice.findMany({
    where: { status: "anulada" },
    select: {
      id: true,
      type: true,
      folioNumber: true,
      businessName: true,
      rutIssuer: true,
      totalAmount: true,
      payments: { select: { amountApplied: true } },
    },
  });

  const targetIds: string[] = [];
  const rows: {
    id: string;
    type: string;
    folio: string;
    prov: string;
    total: number;
    realPaid: number;
  }[] = [];
  for (const inv of anuladas) {
    const realPaid = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    if (realPaid >= inv.totalAmount - TOL) {
      targetIds.push(inv.id);
      rows.push({
        id: inv.id,
        type: inv.type,
        folio: inv.folioNumber ?? "—",
        prov: inv.businessName ?? inv.rutIssuer ?? "",
        total: inv.totalAmount,
        realPaid,
      });
    }
  }

  // NC que referencian a estas facturas (appliedToInvoiceId).
  const ncs = await prisma.invoice.findMany({
    where: { tipoDoc: 61, appliedToInvoiceId: { in: targetIds } },
    select: {
      id: true,
      folioNumber: true,
      totalAmount: true,
      status: true,
      compensationType: true,
      appliedToInvoiceId: true,
    },
  });
  const ncByTarget = new Map<string, typeof ncs>();
  for (const nc of ncs) {
    if (!nc.appliedToInvoiceId) continue;
    const arr = ncByTarget.get(nc.appliedToInvoiceId) ?? [];
    arr.push(nc);
    ncByTarget.set(nc.appliedToInvoiceId, arr);
  }

  console.log(`Facturas a corregir (anulada → pagada): ${rows.length}\n`);
  for (const r of rows) {
    const ncsOf = ncByTarget.get(r.id) ?? [];
    const ncStr =
      ncsOf
        .map(
          (n) =>
            `NC F-${n.folioNumber ?? "—"} ${clp(Math.abs(n.totalAmount))} [${
              n.compensationType ?? "sin clasificar"
            }/${n.status}]`
        )
        .join(", ") || "(sin NC con appliedToInvoiceId)";
    console.log(
      `  ${r.type} F-${r.folio} ${r.prov}\n      total ${clp(r.total)} · pagado banco ${clp(
        r.realPaid
      )} · ${ncStr}`
    );
  }

  if (APPLY) {
    const backup = { fecha: new Date().toISOString(), facturas: rows, ncs };
    const path = `backups/fix-nc-anuladas-pagadas-backup.json`;
    writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`\nBackup escrito: ${path}`);
    // 1) Facturas: anulada → pagada.
    for (const id of targetIds) {
      await prisma.invoice.update({ where: { id }, data: { status: "pagada" } });
    }
    // 2) Sus NC: quedan SIN CLASIFICAR (se conserva referenceFolioNumber).
    for (const nc of ncs) {
      await prisma.invoice.update({
        where: { id: nc.id },
        data: {
          compensationType: null,
          appliedToInvoiceId: null,
          refundBankMovementId: null,
          status: "pendiente",
          paidAt: null,
        },
      });
    }
    console.log(`${ncs.length} NC dejadas sin clasificar.`);
    const recibidas2 = await prisma.invoice.findMany({
      where: { type: "recibida" },
      select: { tipoDoc: true, netAmount: true },
    });
    const gastoDespues = recibidas2.reduce((s, i) => s + sign(i) * i.netAmount, 0);
    console.log(
      `\nGasto recibidas ANTES ${clp(gastoAntes)} · DESPUÉS ${clp(
        gastoDespues
      )} · Δ ${clp(gastoDespues - gastoAntes)}`
    );
    console.log(`${targetIds.length} facturas actualizadas a "pagada".`);
  } else {
    console.log(`\n[DRY-RUN] No se escribió nada.`);
    console.log(`Plan: ${rows.length} facturas → "pagada" · ${ncs.length} NC → sin clasificar.`);
    console.log(`Gasto recibidas actual: ${clp(gastoAntes)} (no cambia: la NC ya resta sola por tipoDoc=61).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
