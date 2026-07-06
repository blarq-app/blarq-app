// CORRIDA ÚNICA — sube Invoice.status desde los pagos (InvoicePayment) para las
// facturas que quedaron atrás (típico: 100% pagadas por transferencia que
// siguen en "pendiente"). Misma regla que bumpInvoiceStatusUpwards.
//
// SEGURO POR DISEÑO:
//   - DRY-RUN por default: sin --apply NO escribe nada, solo muestra el plan.
//   - SOLO SUBE el status (pendiente→parcial→pagada). NUNCA lo baja: una factura
//     marcada "pagada" a mano / migrada de Maxxa con pago incompleto como
//     InvoicePayment (honorarios al líquido, pagos fuera del banco, redondeo de
//     $1-$2) NO se toca — esa es verdad manual de MJ.
//   - NO toca montos ni pagos: solo los campos derivados `status` y `paidAt`.
//   - Excluye anuladas (status manual) y NC (tipoDoc 61, no derivan de pagos).
//   - Guarda snapshot antes/después en scripts/_snapshots/.
//
// Uso:
//   DRY-RUN (default):  npx tsx -r dotenv/config scripts/fix-status-facturas-stale.ts dotenv_config_path=.env.prod
//   APLICAR:            npx tsx -r dotenv/config scripts/fix-status-facturas-stale.ts dotenv_config_path=.env.prod --apply
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const RANK: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };

// Idéntico a bumpInvoiceStatusUpwards: deriva el status de los pagos (tolera $1
// de redondeo) y lo expone junto al sum/paidAt.
function recompute(totalAmount: number, payments: { amountApplied: number; date: Date }[]) {
  const sum = payments.reduce((s, p) => s + p.amountApplied, 0);
  let status: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;
  if (sum >= totalAmount - 1) {
    status = "pagada";
    paidAt = payments.reduce<Date | null>((mx, p) => (!mx || p.date > mx ? p.date : mx), null);
  } else if (sum > 0) {
    status = "parcial";
  }
  return { sum, status, paidAt };
}

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "??";
  console.log(`\n${"=".repeat(70)}`);
  console.log(`HOST: ${host}`);
  console.log(`MODO: ${APPLY ? "APLICAR (escribe en la base)" : "DRY-RUN (no escribe nada)"}`);
  console.log(`${"=".repeat(70)}\n`);

  if (!host.includes("ep-shy-morning") && APPLY) {
    console.error("ABORTADO: --apply solo está permitido contra la base viva ep-shy-morning.");
    process.exit(1);
  }

  const all = await prisma.invoice.findMany({
    where: { status: { not: "anulada" }, tipoDoc: { not: 61 } },
    select: {
      id: true, folioNumber: true, type: true, status: true, paidAt: true,
      totalAmount: true, businessName: true,
      project: { select: { id: true, name: true } },
      payments: { select: { amountApplied: true, bankMovement: { select: { date: true } } } },
    },
  });

  const mismatched = all
    .map((inv) => {
      const pays = inv.payments.map((p) => ({ amountApplied: p.amountApplied, date: p.bankMovement.date }));
      const { sum, status, paidAt } = recompute(inv.totalAmount, pays);
      return { inv, sum, nextStatus: status, nextPaidAt: paidAt };
    })
    .filter((x) => x.nextStatus !== x.inv.status);

  // SOLO SUBIDAS se corrigen. Las bajadas se listan pero NO se tocan.
  const plan = mismatched.filter((x) => RANK[x.nextStatus] > RANK[x.inv.status]);
  const bajadas = mismatched.filter((x) => RANK[x.nextStatus] < RANK[x.inv.status]);

  console.log(`Facturas revisadas (no anuladas, no NC): ${all.length}`);
  console.log(`Status desincronizado vs pagos: ${mismatched.length}`);
  console.log(`  -> A CORREGIR (subidas, status quedó atrás): ${plan.length}`);
  console.log(`  -> INTACTAS (bajadas: marcas manuales/Maxxa, NO se tocan): ${bajadas.length}\n`);

  console.log(`=== A CORREGIR (suben) ===`);
  for (const p of plan) {
    console.log(
      `  [${p.inv.type}] F-${p.inv.folioNumber ?? "?"} ${(p.inv.project?.name ?? p.inv.businessName ?? "").slice(0, 26).padEnd(26)} | total=${clp(p.inv.totalAmount).padStart(13)} pagado=${clp(p.sum).padStart(13)} | ${p.inv.status} -> ${p.nextStatus}`
    );
  }
  console.log(`\n=== INTACTAS (bajarían — se dejan como están, revisar a mano si MJ quiere) ===`);
  for (const p of bajadas) {
    console.log(
      `  [${p.inv.type}] F-${p.inv.folioNumber ?? "?"} ${(p.inv.project?.name ?? p.inv.businessName ?? "").slice(0, 26).padEnd(26)} | total=${clp(p.inv.totalAmount).padStart(13)} pagado=${clp(p.sum).padStart(13)} | ${p.inv.status} (derivado: ${p.nextStatus})`
    );
  }

  // Cuántas facturas RECIBIDAS pendientes gana/pierde cada obra (lo que MJ ve
  // como contador de compromisos). Solo informativo.
  const recibPendDelta = new Map<string, number>();
  for (const p of plan.filter((x) => x.inv.type === "recibida")) {
    const proj = p.inv.project?.name ?? "(sin obra)";
    const era = p.inv.status === "pendiente" ? 1 : 0;
    const sera = p.nextStatus === "pendiente" ? 1 : 0;
    if (sera - era !== 0) recibPendDelta.set(proj, (recibPendDelta.get(proj) ?? 0) + (sera - era));
  }
  if (recibPendDelta.size > 0) {
    console.log(`\nCambio en contador de "facturas recibidas pendientes" por obra:`);
    for (const [proj, d] of [...recibPendDelta.entries()].sort()) console.log(`  ${proj}: ${d > 0 ? "+" : ""}${d}`);
  }

  // Snapshot antes (siempre).
  mkdirSync("scripts/_snapshots", { recursive: true });
  const stamp = process.env.SNAP_STAMP ?? "manual";
  const snap = plan.map((p) => ({
    id: p.inv.id, folio: p.inv.folioNumber, type: p.inv.type, project: p.inv.project?.name,
    total: p.inv.totalAmount, pagado: p.sum, statusAntes: p.inv.status, statusDespues: p.nextStatus,
  }));
  writeFileSync(`scripts/_snapshots/status-stale-${APPLY ? "post" : "pre"}-${stamp}.json`, JSON.stringify(snap, null, 2));

  if (!APPLY) {
    console.log(`\n>> DRY-RUN: no se escribió nada. Para aplicar, agregá --apply.`);
    return;
  }

  // APLICAR — solo status + paidAt, factura por factura.
  console.log(`\n>> APLICANDO ${plan.length} correcciones...`);
  let ok = 0;
  for (const p of plan) {
    await prisma.invoice.update({
      where: { id: p.inv.id },
      data: { status: p.nextStatus, paidAt: p.nextPaidAt },
    });
    ok++;
  }
  console.log(`>> Listo. ${ok} facturas corregidas.`);

  // Verificación post: re-leer y confirmar que NO quedan SUBIDAS pendientes
  // (las bajadas siguen ahí a propósito — son las marcas manuales intactas).
  const after = await prisma.invoice.findMany({
    where: { status: { not: "anulada" }, tipoDoc: { not: 61 } },
    select: { status: true, totalAmount: true, payments: { select: { amountApplied: true, bankMovement: { select: { date: true } } } } },
  });
  const subidasRestantes = after.filter((inv) => {
    const pays = inv.payments.map((p) => ({ amountApplied: p.amountApplied, date: p.bankMovement.date }));
    const d = recompute(inv.totalAmount, pays).status;
    return RANK[d] > RANK[inv.status];
  }).length;
  console.log(`>> Verificación post: subidas pendientes = ${subidasRestantes} (debería ser 0).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
