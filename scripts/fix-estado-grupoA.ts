// Grupo A — corrige la ETIQUETA de estado de facturas recibidas que están
// pagadas (o parciales) de verdad pero dicen "pendiente".
//
// CANDADO: solo SUBE la etiqueta (pendiente→parcial→pagada cuando los pagos lo
// justifican). NUNCA baja (no toca las "pagada sin broche"). No toca anuladas.
// No cambia montos ni pagos — solo el campo status (+ paidAt al pasar a pagada).
//
// Dry-run por defecto. Para escribir: --apply
// Uso:
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/fix-estado-grupoA.ts
//   DATABASE_URL="..." npx tsx scripts/fix-estado-grupoA.ts --apply

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const rank: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—";
  const env = /ep-shy-morning/.test(process.env.DATABASE_URL ?? "") ? "prod" : /ep-solitary-mud/.test(process.env.DATABASE_URL ?? "") ? "dev" : "unknown";
  console.log(`fix-estado-grupoA — ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"} | entorno: ${env} | host: ${host}\n`);

  const invs = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 } },
    select: {
      id: true, folioNumber: true, businessName: true, totalAmount: true, status: true,
      payments: { select: { amountApplied: true, bankMovement: { select: { date: true } } } },
    },
  });

  type Plan = { id: string; folio: string; prov: string; total: number; de: string; a: "pagada" | "parcial"; paidAt: Date | null };
  const plan: Plan[] = [];
  for (const inv of invs) {
    if (inv.status === "anulada") continue;
    const sum = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    let next: "pendiente" | "parcial" | "pagada" = "pendiente";
    let paidAt: Date | null = null;
    if (sum >= inv.totalAmount - 1) {
      next = "pagada";
      paidAt = inv.payments.reduce<Date | null>((l, p) => (!l || p.bankMovement.date > l ? p.bankMovement.date : l), null);
    } else if (sum > 0) next = "parcial";
    // CANDADO: solo subir
    if (rank[next] <= rank[inv.status]) continue;
    plan.push({ id: inv.id, folio: String(inv.folioNumber), prov: inv.businessName ?? "", total: inv.totalAmount, de: inv.status, a: next, paidAt });
  }

  const aPagada = plan.filter((p) => p.a === "pagada");
  const aParcial = plan.filter((p) => p.a === "parcial");
  console.log(`A subir a PAGADA: ${aPagada.length} · ${fmt(aPagada.reduce((s, p) => s + p.total, 0))}`);
  console.log(`A subir a PARCIAL: ${aParcial.length} · ${fmt(aParcial.reduce((s, p) => s + p.total, 0))}`);
  console.log(`TOTAL a cambiar: ${plan.length} facturas (solo etiqueta; cero cambio de monto/pagos)\n`);

  // gasto por obra ANTES (suma de totalAmount de recibidas no-anuladas, no-NC) — guard: no debe cambiar
  const gastoAntes = invs.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);

  if (!APPLY) {
    console.log("(dry-run — no se escribió nada. Agregá --apply para escribir.)");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const p of plan) {
    await prisma.invoice.update({ where: { id: p.id }, data: { status: p.a, paidAt: p.paidAt } });
    done++;
  }
  console.log(`Escritas: ${done} facturas.`);

  // verificación post
  const post = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { status: true, totalAmount: true },
  });
  const gastoDespues = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nVerificación gasto (suma totalAmount recibidas no-anuladas): antes ${fmt(gastoAntes)} | después ${fmt(gastoDespues)} | Δ ${fmt(gastoDespues - gastoAntes)}`);
  const dist = post.reduce<Record<string, number>>((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {});
  console.log(`Distribución de estado (recibidas no-NC):`, JSON.stringify(dist));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
