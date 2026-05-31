// Concilia en la app las facturas RECIBIDAS de la Sección 1 del reporte
// REVIEW_maxxa-conciliacion-pendiente_2026-05-30: facturas que Maxxa tiene
// pagadas y la app dejó pendientes. Crea InvoicePayment (manual,
// autoMatched=false), pone el mov en conciliado/parcial y recomputa el
// estado de la factura. NO mueve totales de plata (gasto no depende de pago).
//
// Autocontenido: calcula el plan desde los Excel de Maxxa (~/Downloads) y
// verifica/escribe contra la BD en vivo. Dry-run por default; --apply escribe.
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const DL = "/Users/mjblanco/Downloads";
// Excluidos (confirmado con MJ): 3 cruces de tarjeta (van por Sección 4) + Maxi Mobility (sin mov en cartola)
const EXCLUDE_FOLIOS = new Set(["2963377", "2988549", "106843", "38153"]);

const normRut = (s: string) => String(s || "").replace(/[.\s]/g, "").replace(/^0+/, "").toUpperCase().trim();
const normFolio = (s: string) => { const v = String(s ?? "").replace(/[^0-9]/g, "").replace(/^0+/, ""); return v || "0"; };
const numH = (s: string) => { const c = String(s ?? "").replace(/[.\s$]/g, "").replace(/,/g, "."); const n = Number(c); return isNaN(n) ? 0 : Math.round(n); };
const numX = (s: any) => { const n = Number(String(s ?? "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : Math.round(n); };
const ymd = (d: any) => String(d ?? "").slice(0, 10);
const gl = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");

function loadMaxxaRec() {
  const $ = cheerio.load(readFileSync(`${DL}/exportar.xls`, "utf-8"));
  const rows = $("table tr");
  const H = rows.first().find("td").map((_, td) => $(td).text().trim()).get();
  const gi = (n: string) => H.indexOf(n);
  const out: any[] = [];
  rows.slice(1).each((_, tr) => {
    const t = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    if (t.length < 10) return;
    out.push({ tipoDoc: Number(t[gi("CodTipoDoc")]), folio: normFolio(t[gi("FolioDoc")]), rut: normRut(t[gi("RutDoc")]), nom: t[gi("NomAux")], total: numH(t[gi("MontoTotal")]), saldo: numH(t[gi("Saldo")]), anulada: t[gi("Anulada")] === "SI", fecha: ymd(t[gi("FechaDoc")]) });
  });
  return out;
}
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
  console.log(`Entorno: ${/ep-shy-morning/.test(process.env.DATABASE_URL ?? "") ? "PROD" : "?"}  | modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN"}`);
  const mxRec = loadMaxxaRec();
  const cartola = [
    ...loadCartola("MovimientosCartola_20260530_2156.xlsx").filter((m) => m.fecha < "2026-02-17"),
    ...loadCartola("MovimientosCartola_20260530_1912.xlsx").filter((m) => m.fecha >= "2026-02-17"),
  ];
  // candidatas: Maxxa pagada, no anulada, no NC/traspaso, no excluidas
  const cands = mxRec.filter((m) => m.saldo <= 1 && !m.anulada && m.tipoDoc !== 1054 && m.tipoDoc !== 61 && !EXCLUDE_FOLIOS.has(m.folio));
  // movimientos que pagan cada factura (de la cartola)
  const movsFor = (m: any) => {
    const out: any[] = [];
    for (const cm of cartola) for (const a of cm.asign) if (a.folio === m.folio && a.tipoDoc === m.tipoDoc && normRut(a.rut) === normRut(m.rut)) out.push({ fecha: cm.fecha, monto: cm.monto, desc: cm.desc, abono: a.abono });
    return out;
  };

  const movCap = new Map<string, number>();
  let okCount = 0; let totalApplied = 0;
  const writes: any[] = []; const problems: string[] = [];

  for (const m of cands) {
    const inv = await prisma.invoice.findFirst({
      where: { type: "recibida", tipoDoc: m.tipoDoc, folioNumber: m.folio, rutIssuer: { contains: m.rut.slice(0, -1) } },
      select: { id: true, totalAmount: true, status: true },
    });
    if (!inv) continue; // no está en app o folio distinto: no es de esta sección
    if (inv.status !== "pendiente") continue; // ya pagada/parcial: fuera de alcance
    const movs = movsFor(m);
    if (!movs.length) { problems.push(`F-${m.folio} ${m.nom}: sin movimiento en cartola`); continue; }

    const already = (await prisma.invoicePayment.aggregate({ where: { invoiceId: inv.id }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0;
    let invRemaining = inv.totalAmount - already;
    let didOne = false;
    for (const mv of movs) {
      if (invRemaining < 1) break;
      const dayStart = new Date(mv.fecha + "T00:00:00.000Z"); const dayEnd = new Date(mv.fecha + "T23:59:59.999Z");
      const cs = await prisma.bankMovement.findMany({ where: { date: { gte: dayStart, lte: dayEnd } }, select: { id: true, amount: true, description: true } });
      const absM = Math.abs(mv.monto);
      let cand = cs.filter((c) => Math.abs(Math.round(Math.abs(c.amount) - absM)) <= 1);
      if (cand.length > 1) { const g = gl(mv.desc).slice(0, 14); const bg = cand.filter((c) => gl(c.description).slice(0, 14) === g); if (bg.length) cand = bg; }
      if (!cand.length) { problems.push(`F-${m.folio} ${m.nom}: mov ${mv.fecha} $${fmt(absM)} no está en app`); continue; }
      const mov = cand[0];
      const liveApplied = (await prisma.invoicePayment.aggregate({ where: { bankMovementId: mov.id }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0;
      const movRemaining = Math.abs(mov.amount) - liveApplied - (movCap.get(mov.id) ?? 0);
      if (movRemaining < 1) { problems.push(`F-${m.folio} ${m.nom}: mov ${mv.fecha} sin capacidad libre`); continue; }
      const apply = Math.min(mv.abono || invRemaining, invRemaining, movRemaining);
      if (apply < 1) continue;
      movCap.set(mov.id, (movCap.get(mov.id) ?? 0) + apply);
      invRemaining -= apply; totalApplied += apply; didOne = true;
      writes.push({ invId: inv.id, movId: mov.id, amount: Math.round(apply), folio: m.folio, nom: m.nom, fecha: mv.fecha });
    }
    if (didOne) okCount++;
  }

  console.log(`\nFacturas a conciliar: ${okCount} | imputaciones a crear: ${writes.length} | Σ a imputar: $${fmt(totalApplied)}`);
  if (problems.length) { console.log(`\nOMITIDOS (${problems.length}):`); problems.forEach((p) => console.log("  - " + p)); }
  console.log("\nImputaciones planificadas:");
  for (const w of writes) console.log(`  F-${w.folio.padEnd(10)} ${(w.nom || "").slice(0, 28).padEnd(28)} ${w.fecha}  $${fmt(w.amount)}`);

  if (!APPLY) { console.log("\n(DRY-RUN — no se escribió nada. Para aplicar: --apply)"); await prisma.$disconnect(); return; }

  console.log("\nAPLICANDO...");
  const tInv = new Set<string>(); const tMov = new Set<string>();
  for (const w of writes) { await prisma.invoicePayment.create({ data: { bankMovementId: w.movId, invoiceId: w.invId, amountApplied: w.amount, autoMatched: false } }); tInv.add(w.invId); tMov.add(w.movId); }
  for (const movId of tMov) {
    const mm = await prisma.bankMovement.findUnique({ where: { id: movId }, select: { amount: true } });
    const applied = (await prisma.invoicePayment.aggregate({ where: { bankMovementId: movId }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0;
    await prisma.bankMovement.update({ where: { id: movId }, data: { status: applied >= Math.abs(mm!.amount) - 1 ? "conciliado" : "parcial" } });
  }
  for (const invId of tInv) await recomputeInvoiceStatus(invId);
  console.log(`Listo: ${writes.length} imputaciones, ${tInv.size} facturas, ${tMov.size} movimientos.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
