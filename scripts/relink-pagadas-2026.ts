// Re-enlaza facturas RECIBIDAS de 2026 que están sin enlace de pago completo
// (incluye el bug "pagada sin InvoicePayment" de la ronda 35), usando la
// conciliación de Maxxa (cartola Operativa 2026) como fuente del movimiento.
// REGLA DE SEGURIDAD: solo escribe si los movimientos cubren el 100% de la
// factura — nunca enlaces parciales (degradarían una pagada a parcial).
// Excluye anomalías (cruces S4 + Studio Group anulada + Maxi Mobility) por
// folio y por falta de capacidad. Dry-run por default; --apply escribe.
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const DL = "/Users/mjblanco/Downloads";
const DUMP = "backups/audit-facturas-conciliacion-2026-05-31T03-21.json";
const EXCLUDE_FOLIOS = new Set(["2963377", "2988549", "106843", "38153", "240877", "305"]);

const normRut = (s: string) => String(s || "").replace(/[.\s]/g, "").replace(/^0+/, "").toUpperCase().trim();
const normFolio = (s: string) => { const v = String(s ?? "").replace(/[^0-9]/g, "").replace(/^0+/, ""); return v || "0"; };
const numX = (s: any) => { const n = Number(String(s ?? "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : Math.round(n); };
const ymd = (d: any) => String(d ?? "").slice(0, 10);
const gl = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");

function loadCartola(file: string) {
  const wb = XLSX.read(readFileSync(`${DL}/${file}`));
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  const H = rows[0]; const ci = (n: string) => H.indexOf(n);
  return rows.slice(1).filter((r) => r.length > 3).map((r) => {
    let asign: any[] = []; const raw = r[ci("Asignacion")];
    if (raw && raw !== "") { try { const j = JSON.parse(String(raw).split("];")[0] + "]"); asign = j.map((a: any) => ({ folio: normFolio(a.Folio), rut: normRut(a.Rut), tipoDoc: Number(a.TipoDoc), abono: numX(a.Abono) })); } catch {} }
    return { desc: r[ci("descripcion")], monto: numX(r[ci("monto")]), fecha: ymd(r[ci("fecha_transaccion")]), asign };
  });
}

async function main() {
  console.log(`Entorno: ${/ep-shy-morning/.test(process.env.DATABASE_URL ?? "") ? "PROD" : "?"} | modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const dump = JSON.parse(readFileSync(DUMP, "utf-8"));
  const cartola = [
    ...loadCartola("MovimientosCartola_20260530_2156.xlsx").filter((m) => m.fecha < "2026-02-17"),
    ...loadCartola("MovimientosCartola_20260530_1912.xlsx").filter((m) => m.fecha >= "2026-02-17"),
  ];
  const paysByInv = new Map<string, number>();
  for (const p of dump.invoicePayments) paysByInv.set(p.invoiceId, (paysByInv.get(p.invoiceId) || 0) + p.amountApplied);
  const paysByMov = new Map<string, number>();
  for (const p of dump.invoicePayments) paysByMov.set(p.bankMovementId, (paysByMov.get(p.bankMovementId) || 0) + p.amountApplied);
  const movByKey = new Map<string, any[]>();
  for (const m of dump.bankMovements) { const k = ymd(m.date) + "|" + Math.abs(Math.round(m.amount)); if (!movByKey.has(k)) movByKey.set(k, []); movByKey.get(k)!.push(m); }
  const movsFor = (td: number, fo: string, ru: string) => { const out: any[] = []; for (const cm of cartola) for (const a of cm.asign) if (a.folio === normFolio(fo) && a.tipoDoc === td && normRut(a.rut) === normRut(ru)) out.push({ fecha: cm.fecha, monto: cm.monto, desc: cm.desc, abono: a.abono }); return out; };
  const findMov = (mv: any) => { const c = movByKey.get(mv.fecha + "|" + Math.abs(mv.monto)) || []; if (c.length <= 1) return c[0] || null; const g = gl(mv.desc).slice(0, 14); return c.find((x) => gl(x.description).slice(0, 14) === g) || c[0]; };

  const movPlanned = new Map<string, number>();
  const writes: any[] = []; const skipped: string[] = [];
  const appRec = dump.invoices.filter((i: any) => i.type === "recibida");

  for (const inv of appRec) {
    if (ymd(inv.issueDate).slice(0, 4) !== "2026") continue; // solo 2026
    if (inv.status === "anulada") continue;
    if (EXCLUDE_FOLIOS.has(normFolio(inv.folioNumber))) continue;
    const applied = paysByInv.get(inv.id) || 0;
    const remaining = inv.totalAmount - applied;
    if (remaining < 1) continue; // ya enlazada completa
    const movs = movsFor(inv.tipoDoc, inv.folioNumber, inv.rutIssuer);
    if (!movs.length) continue; // sin cartola → Fase 2

    // intentar cubrir el 100% con capacidad disponible
    const tentative: any[] = []; let covered = 0;
    for (const mv of movs) {
      if (covered >= remaining - 1) break;
      const mov = findMov(mv);
      if (!mov) { covered = -1; break; } // mov no importado → no se puede cubrir full
      const cap = Math.abs(mov.amount) - (paysByMov.get(mov.id) || 0) - (movPlanned.get(mov.id) || 0);
      if (cap < 1) continue;
      const apply = Math.min(mv.abono || cap, remaining - covered, cap);
      if (apply < 1) continue;
      tentative.push({ movId: mov.id, amount: Math.round(apply) }); covered += apply;
    }
    if (covered < remaining - 1) { skipped.push(`F-${normFolio(inv.folioNumber)} ${inv.businessName} (${inv.status}): no se cubre 100% ($${fmt(Math.max(0,covered))}/$${fmt(remaining)})`); continue; }
    // commit: reservar capacidad y registrar writes
    for (const t of tentative) { movPlanned.set(t.movId, (movPlanned.get(t.movId) || 0) + t.amount); writes.push({ ...t, invId: inv.id, folio: normFolio(inv.folioNumber), nom: inv.businessName, status: inv.status }); }
  }

  const totalA = writes.reduce((s, w) => s + w.amount, 0);
  const invSet = new Set(writes.map((w) => w.invId));
  console.log(`\nFacturas a re-enlazar: ${invSet.size} | imputaciones: ${writes.length} | Σ $${fmt(totalA)}`);
  console.log("\nDetalle:");
  const byInv = new Map<string, any[]>(); for (const w of writes) { if (!byInv.has(w.invId)) byInv.set(w.invId, []); byInv.get(w.invId)!.push(w); }
  for (const [, ws] of byInv) console.log(`  F-${ws[0].folio.padEnd(11)} ${(ws[0].nom||"").slice(0,28).padEnd(28)} [${ws[0].status}] → $${fmt(ws.reduce((s,w)=>s+w.amount,0))} (${ws.length} mov)`);
  if (skipped.length) { console.log(`\nOmitidos (no cubren 100% → quedan como están): ${skipped.length}`); skipped.slice(0,20).forEach((s) => console.log("  - " + s)); }

  if (!APPLY) { console.log("\n(DRY-RUN — nada escrito. --apply para aplicar)"); await prisma.$disconnect(); return; }
  console.log("\nAPLICANDO...");
  const tMov = new Set<string>();
  for (const w of writes) { await prisma.invoicePayment.create({ data: { bankMovementId: w.movId, invoiceId: w.invId, amountApplied: w.amount, autoMatched: false } }); tMov.add(w.movId); }
  for (const movId of tMov) { const mm = await prisma.bankMovement.findUnique({ where: { id: movId }, select: { amount: true } }); const ap = (await prisma.invoicePayment.aggregate({ where: { bankMovementId: movId }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0; await prisma.bankMovement.update({ where: { id: movId }, data: { status: ap >= Math.abs(mm!.amount) - 1 ? "conciliado" : "parcial" } }); }
  for (const invId of invSet) await recomputeInvoiceStatus(invId);
  console.log(`Listo: ${writes.length} imputaciones, ${invSet.size} facturas, ${tMov.size} movimientos.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
