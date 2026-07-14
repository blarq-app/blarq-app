// Diagnóstico SOLO LECTURA: facturas cuyo `status` guardado NO coincide con el
// que daría Σ InvoicePayment.amountApplied — y por qué (casi siempre NO es bug).
//
// Uso: npx tsx scripts/diag-factura-status-descuadre.ts [.env.prod] [salida.json]
//
// Lee DATABASE_URL DIRECTO del archivo (NO usa dotenv, que cargaría la base
// vieja ep-solitary-mud — ver §4.9 del CLAUDE.md). Imprime el HOST para
// confirmar que está en la base viva (ep-shy-morning). No escribe nada en la BD.
//
// HALLAZGO (2026-07-13): el "estado descuadrado" casi nunca es un bug. El estado
// REAL de una factura recibida no sale solo de los pagos bancarios; también lo
// saldan (a) las Notas de Crédito aplicadas, (b) la retención de una BHE pagada
// al líquido, (c) un pago manual/legacy fuera del banco. `recomputeInvoiceStatus`
// solo mira los pagos → cree que están descuadradas cuando en realidad están
// bien. Este script separa el ruido (NC, anuladas, retención, manual) del
// verdadero "stale" (status por encima de lo que justifica CUALQUIER cobertura).

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const RANK: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };

// Status derivado SOLO de pagos (lo que hace hoy recomputeInvoiceStatus).
function statusFromPayments(total: number, sumPagos: number) {
  if (sumPagos >= total - 1) return "pagada";
  if (sumPagos > 0) return "parcial";
  return "pendiente";
}
// Status "verdadero" contando pagos + NC aplicadas (other_invoice).
function statusFromSettled(total: number, settled: number) {
  if (settled >= total - 10) return "pagada";
  if (settled > 0) return "parcial";
  return "pendiente";
}

// Retención estimada de una BHE (tipoDoc 1039): en 2025 ~13%, 2026 ~14,5%.
// Solo se usa para EXPLICAR (no para escribir): si el pago ≈ total − retención,
// la BHE está pagada al líquido y "pagada" es correcto.
function pareceBheAlLiquido(tipoDoc: number | null, total: number, sumPagos: number) {
  if (tipoDoc !== 1039) return false;
  if (sumPagos <= 0) return false;
  const faltante = total - sumPagos;
  const pct = faltante / total;
  return pct > 0.1 && pct < 0.16; // ventana de retención BHE
}

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  const marker = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador base viva → #64 =", marker?.name ?? "(no existe)", "(esperado: Paseo del Sena)");
  if (!host.startsWith("ep-shy-morning")) {
    console.log("\n⚠️  HOST no es ep-shy-morning — NO es la base viva. Abortando.");
    return;
  }

  const invoices = await prisma.invoice.findMany({
    select: {
      id: true, folioNumber: true, businessName: true, type: true, tipoDoc: true,
      totalAmount: true, status: true, paidAt: true, origin: true,
      project: { select: { name: true, numeroProyecto: true } },
      payments: { select: { amountApplied: true } },
    },
  });
  console.log("\nFacturas totales:", invoices.length);

  // NCs aplicadas por factura objetivo (other_invoice → appliedToInvoiceId).
  const ncPorFactura = new Map<string, number>();
  const ncs = await prisma.invoice.findMany({
    where: { tipoDoc: 61, appliedToInvoiceId: { not: null } },
    select: { appliedToInvoiceId: true, totalAmount: true },
  });
  for (const n of ncs) {
    const k = n.appliedToInvoiceId!;
    ncPorFactura.set(k, (ncPorFactura.get(k) ?? 0) + Math.abs(n.totalAmount));
  }

  // Clasificar TODAS las que no calzan status-vs-pagos.
  const anuladas: string[] = [];
  const notasCredito: string[] = [];
  const okPorNC: any[] = [];        // pagada correcta = pago + NC
  const parcialPorNC: any[] = [];   // parcial correcta = NC parcial
  const bheAlLiquido: any[] = [];   // BHE pagada al líquido (retención)
  const manualLegacy: any[] = [];   // pago manual/legacy fuera del banco
  const redondeo: any[] = [];       // diff ≤ $5
  const staleReal: any[] = [];      // NADA lo justifica → verdadero bug

  for (const inv of invoices) {
    const sumPagos = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const derivedPagos = statusFromPayments(inv.totalAmount, sumPagos);
    if (inv.status === derivedPagos) continue; // calza con pagos → nada que ver

    if (inv.status === "anulada") { anuladas.push(inv.id); continue; }
    if (inv.tipoDoc === 61) { notasCredito.push(inv.id); continue; }

    // Solo miramos "status por encima de los pagos" (el understated no aparece hoy).
    if (RANK[inv.status] <= RANK[derivedPagos]) { continue; }

    const ncSum = ncPorFactura.get(inv.id) ?? 0;
    const settled = sumPagos + ncSum;
    const derivedSettled = statusFromSettled(inv.totalAmount, settled);
    const row = {
      id: inv.id, folio: inv.folioNumber, prov: inv.businessName, tipoDoc: inv.tipoDoc,
      obra: inv.project ? `#${inv.project.numeroProyecto} ${inv.project.name}` : "(sin obra)",
      total: inv.totalAmount, status: inv.status, sumPagos, ncSum, settled,
      derivedPagos, derivedSettled, nPagos: inv.payments.length, origin: inv.origin, paidAt: inv.paidAt,
    };

    if (inv.status === derivedSettled) {
      // El status ES correcto contando la NC.
      if (inv.status === "pagada") okPorNC.push(row);
      else parcialPorNC.push(row);
    } else if (Math.abs(inv.totalAmount - sumPagos) <= 5) {
      redondeo.push(row);
    } else if (pareceBheAlLiquido(inv.tipoDoc, inv.totalAmount, sumPagos)) {
      bheAlLiquido.push(row);
    } else if (inv.tipoDoc === 1043 || inv.origin.includes("legacy") || inv.origin.includes("sin_respaldo")) {
      manualLegacy.push(row);
    } else {
      staleReal.push(row);
    }
  }

  const fmt = (r: any) => [
    `F-${r.folio}`.padEnd(13),
    (r.prov ?? "").slice(0, 24).padEnd(24),
    String(r.obra).slice(0, 22).padEnd(22),
    "tot " + clp(r.total).padStart(11),
    "pago " + clp(r.sumPagos).padStart(11),
    "NC " + clp(r.ncSum).padStart(9),
    `${r.status}→(pagos)${r.derivedPagos}`.padEnd(24),
    `n=${r.nPagos}`, r.origin,
  ].join("  ");

  console.log(`\nRESUMEN DE "DESCUADRES":`);
  console.log(`  Notas de Crédito (estado por compensación, NO por pagos) ..... ${notasCredito.length}  [esperado, no bug]`);
  console.log(`  Anuladas (estado manual intencional) ......................... ${anuladas.length}  [esperado, no bug]`);
  console.log(`  Pagada correcta = pago + Nota de Crédito ..................... ${okPorNC.length}  [correcta; recompute la bajaría MAL]`);
  console.log(`  Parcial correcta = NC parcial ................................ ${parcialPorNC.length}  [correcta]`);
  console.log(`  BHE pagada al líquido (la diferencia es la retención) ........ ${bheAlLiquido.length}  [correcta]`);
  console.log(`  Pago manual/legacy fuera del banco ........................... ${manualLegacy.length}  [correcta a propósito]`);
  console.log(`  Redondeo (diff ≤ $5) ......................................... ${redondeo.length}  [cosmético]`);
  console.log(`  STALE REAL (nada lo justifica → verdadero bug tipo SODIMAC) .. ${staleReal.length}`);

  const dump = (titulo: string, arr: any[]) => {
    if (arr.length === 0) return;
    console.log(`\n--- ${titulo} (${arr.length}) ---`);
    arr.forEach((r) => console.log("  " + fmt(r)));
  };
  dump("STALE REAL — verdadero bug (revisar)", staleReal);
  dump("Pago manual/legacy (NO tocar — pagada a propósito)", manualLegacy);
  dump("BHE al líquido (NO tocar — retención)", bheAlLiquido);
  dump("Parcial por NC (correcta)", parcialPorNC);
  dump("Pagada por pago+NC (correcta; recompute la rompería)", okPorNC);

  // Caso reportado.
  const s = invoices.find((i) => String(i.folioNumber) === "145362306");
  console.log("\n=== CASO REPORTADO SODIMAC F-145362306 ===");
  console.log(s ? `  status=${s.status}, pagos=${s.payments.length} → ${s.status === "pendiente" ? "YA cuadra (MJ la corrigió a mano)" : "sigue rara"}` : "  no encontrada");

  const out = process.argv[3] ?? "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/872723da-f734-4ba2-ac29-dcc64018f5a2/scratchpad/descuadre-facturas.json";
  writeFileSync(out, JSON.stringify({ host, staleReal, manualLegacy, bheAlLiquido, parcialPorNC, okPorNC,
    counts: { notasCredito: notasCredito.length, anuladas: anuladas.length, okPorNC: okPorNC.length,
      parcialPorNC: parcialPorNC.length, bheAlLiquido: bheAlLiquido.length, manualLegacy: manualLegacy.length,
      redondeo: redondeo.length, staleReal: staleReal.length } }, null, 2));
  console.log("\nJSON guardado en:", out);
}

main().catch((e) => console.error("ERROR:", e.message)).finally(() => prisma.$disconnect());
