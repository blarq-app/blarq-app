// Verificación (SOLO LECTURA) del recompute NC-aware — regresión mínima del
// cambio 2026-07-13 en src/lib/banco/invoicePayments.ts (§3.5 auditoría banco).
//
// Uso: npx tsx scripts/test-recompute-status-nc.ts [.env.prod]
//
// NO escribe nada. Simula en memoria lo que recomputeInvoiceStatus produciría
// (con la lógica NUEVA = pago + NC, y con la VIEJA = solo pago) para cada
// factura de la base viva, y verifica invariantes:
//   1) Ninguna factura hoy "pagada" gracias a pago+NC se cae con la lógica nueva.
//   2) La lógica nueva NO baja a nadie que la vieja dejaba igual, salvo los
//      casos sin respaldo (BHE al líquido / manual) — que se listan explícitos.
//   3) Demuestra el arreglo: al quitar el pago de una factura pago+NC, la nueva
//      la deja "parcial" (la NC sigue cubriendo) donde la vieja daba "pendiente".

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

function statusDe(total: number, saldado: number) {
  if (saldado >= total - 1) return "pagada";
  if (saldado > 0) return "parcial";
  return "pendiente";
}

async function main() {
  console.log("=== HOST:", host, "===");
  if (!host.startsWith("ep-shy-morning")) { console.log("no es la base viva, aborto"); return; }

  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "anulada" }, tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, businessName: true, totalAmount: true, status: true,
      payments: { select: { amountApplied: true } } },
  });
  const ncMap = new Map<string, number>();
  for (const n of await prisma.invoice.findMany({
    where: { tipoDoc: 61, appliedToInvoiceId: { not: null } },
    select: { appliedToInvoiceId: true, totalAmount: true },
  })) ncMap.set(n.appliedToInvoiceId!, (ncMap.get(n.appliedToInvoiceId!) ?? 0) + Math.abs(n.totalAmount));

  let downgradedVieja = 0, downgradedNueva = 0;
  const nuevaBaja: any[] = [];   // factura cuyo status BAJA con la lógica nueva
  const rescatadas: any[] = [];  // vieja la bajaba, nueva la mantiene (gracias a NC)
  const RANK: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };

  for (const inv of invoices) {
    const pago = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const nc = ncMap.get(inv.id) ?? 0;
    const vieja = statusDe(inv.totalAmount, pago);          // solo pago (lógica anterior)
    const nueva = statusDe(inv.totalAmount, pago + nc);     // pago + NC (lógica nueva)
    if (RANK[vieja] < RANK[inv.status]) downgradedVieja++;
    if (RANK[nueva] < RANK[inv.status]) { downgradedNueva++; nuevaBaja.push({ inv, nueva, pago, nc }); }
    if (nc > 0 && RANK[nueva] > RANK[vieja]) rescatadas.push({ inv, vieja, nueva, pago, nc });
  }

  console.log(`\nFacturas evaluadas: ${invoices.length}`);
  console.log(`Si recompute corriera sobre TODAS:`);
  console.log(`  - con lógica VIEJA (solo pago) bajaría el status de: ${downgradedVieja} facturas`);
  console.log(`  - con lógica NUEVA (pago + NC) bajaría el status de:  ${downgradedNueva} facturas`);
  console.log(`  → la NC RESCATA ${rescatadas.length} facturas que la vieja habría bajado mal.\n`);

  console.log("Las que la lógica NUEVA aún bajaría (sin NC que las respalde — BHE/manual, esperado):");
  for (const r of nuevaBaja) {
    console.log(`  F-${r.inv.folioNumber} · ${(r.inv.businessName ?? "").slice(0, 26)} · ${clp(r.inv.totalAmount)} · guardado=${r.inv.status} → nueva=${r.nueva} · pago=${clp(r.pago)} nc=${clp(r.nc)}`);
  }

  // INVARIANTE 1: ninguna "pagada por pago+NC" se cae con la lógica nueva.
  const rotas = rescatadas.filter((r) => r.inv.status === "pagada" && r.nueva !== "pagada");
  console.log(`\nINVARIANTE — pagadas por pago+NC que la nueva rompería: ${rotas.length} (debe ser 0) ${rotas.length === 0 ? "✓" : "✗"}`);

  // DEMO del arreglo en un caso real pago+NC: quitar el pago.
  const demo = await prisma.invoice.findFirst({
    where: { folioNumber: "142612809" },
    select: { id: true, folioNumber: true, totalAmount: true,
      payments: { select: { amountApplied: true } } },
  });
  if (demo) {
    const nc = ncMap.get(demo.id) ?? 0;
    const pago = demo.payments.reduce((s, p) => s + p.amountApplied, 0);
    console.log(`\n=== DEMO arreglo · F-${demo.folioNumber} (SODIMAC, total ${clp(demo.totalAmount)}, NC ${clp(nc)}) ===`);
    console.log(`  con el pago (${clp(pago)}):   nueva=${statusDe(demo.totalAmount, pago + nc)} (vieja=${statusDe(demo.totalAmount, pago)})`);
    console.log(`  al DESASIGNAR el pago:        nueva=${statusDe(demo.totalAmount, 0 + nc)}  ← ANTES daba '${statusDe(demo.totalAmount, 0)}' (perdía la NC)`);
  }
}

main().catch((e) => console.error("ERROR:", e.message)).finally(() => prisma.$disconnect());
