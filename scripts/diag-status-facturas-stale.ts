// READ-ONLY. Diagnóstico: ¿qué facturas tienen Invoice.status desactualizado
// respecto de sus pagos (InvoicePayment)? Replica la lógica de
// recomputeInvoiceStatus SIN escribir nada. Corre contra la base que indique
// el .env que se pase por DOTENV_CONFIG_PATH (usar .env.prod = base viva).
//
//   npx tsx -r dotenv/config scripts/diag-status-facturas-stale.ts dotenv_config_path=.env.prod
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Misma regla que src/lib/banco/invoicePayments.ts:recomputeInvoiceStatus.
function statusEsperado(totalAmount: number, sumApplied: number): "pendiente" | "parcial" | "pagada" {
  if (sumApplied >= totalAmount - 1) return "pagada";
  if (sumApplied > 0) return "parcial";
  return "pendiente";
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "??";
  console.log(`HOST: ${host}\n`);

  // 1) Caso reportado: F-94/95/96 de Dpto Holanda 940 / Raimundo Alvarez.
  const holanda = await prisma.invoice.findMany({
    where: {
      type: "emitida",
      OR: [
        { businessName: { contains: "Holanda", mode: "insensitive" } },
        { businessName: { contains: "Raimundo", mode: "insensitive" } },
        { project: { name: { contains: "Holanda", mode: "insensitive" } } },
      ],
      folioNumber: { in: ["94", "95", "96"] },
    },
    select: {
      id: true, folioNumber: true, type: true, status: true, totalAmount: true,
      businessName: true, paidAt: true,
      project: { select: { id: true, name: true } },
      payments: { select: { amountApplied: true } },
    },
    orderBy: { folioNumber: "asc" },
  });
  console.log("=== Caso reportado (Holanda F-94/95/96) ===");
  for (const inv of holanda) {
    const sum = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const esperado = statusEsperado(inv.totalAmount, sum);
    const flag = esperado !== inv.status ? "  <-- STALE" : "";
    console.log(
      `  F-${inv.folioNumber} ${inv.project?.name ?? "(sin obra)"} | total=${inv.totalAmount.toLocaleString("es-CL")} | pagado=${sum.toLocaleString("es-CL")} | status=${inv.status} -> esperado=${esperado}${flag}`
    );
  }
  if (holanda.length === 0) console.log("  (no se encontraron F-94/95/96 de Holanda)");

  // 2) Barrido global: TODAS las facturas con status != esperado.
  // NC (tipoDoc 61) y anuladas se excluyen (no son derivadas de pagos).
  const all = await prisma.invoice.findMany({
    where: { status: { not: "anulada" }, tipoDoc: { not: 61 } },
    select: {
      id: true, folioNumber: true, type: true, status: true, totalAmount: true,
      businessName: true,
      project: { select: { name: true } },
      payments: { select: { amountApplied: true } },
    },
  });

  const stale = all
    .map((inv) => {
      const sum = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
      return { inv, sum, esperado: statusEsperado(inv.totalAmount, sum) };
    })
    .filter((x) => x.esperado !== x.inv.status);

  console.log(`\n=== Barrido global ===`);
  console.log(`Facturas revisadas (no anuladas, no NC): ${all.length}`);
  console.log(`STALE (status guardado != status por pagos): ${stale.length}\n`);

  // Desglose por transición.
  const trans = new Map<string, number>();
  for (const s of stale) {
    const k = `${s.inv.status} -> ${s.esperado}`;
    trans.set(k, (trans.get(k) ?? 0) + 1);
  }
  console.log("Transiciones (actual -> esperado):");
  for (const [k, n] of [...trans.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log(`\nDetalle (primeras 60):`);
  for (const s of stale.slice(0, 60)) {
    console.log(
      `  [${s.inv.type}] F-${s.inv.folioNumber ?? "?"} ${(s.inv.project?.name ?? s.inv.businessName ?? "").slice(0, 28).padEnd(28)} | total=${s.inv.totalAmount.toLocaleString("es-CL").padStart(12)} | pagado=${s.sum.toLocaleString("es-CL").padStart(12)} | ${s.inv.status} -> ${s.esperado}`
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
