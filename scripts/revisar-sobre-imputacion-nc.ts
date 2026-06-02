// READ-ONLY: casos donde a una factura se le imputó MÁS plata que su total
// ("el mov supera el saldo"), cruzando si hay una nota de crédito (NC) detrás
// — el enredo típico: compra $1M, devolución $200k (NC), pero el $1M sigue
// conciliado y la devolución queda sin explicar.
//
// Mira las dos fuentes de imputación: los pagos en la app (InvoicePayment) y
// lo que Maxxa imputó (cartola Operativa). Para cada factura sobre-imputada
// busca su NC en la app (tipoDoc 61 que la referencia). NO toca la BD.
//
// Uso: npx tsx scripts/revisar-sobre-imputacion-nc.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";

const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir).filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json")).sort().pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.alias ?? p.id]));
const rut8 = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);

// pagos app por factura
const appPays = new Map<string, { amount: number }[]>();
for (const p of d.invoicePayments) (appPays.get(p.invoiceId) ?? appPays.set(p.invoiceId, []).get(p.invoiceId)!).push({ amount: p.amountApplied });

// NC recibidas indexadas por (folio original + rut): referenceFolioNumber
const ncByOrig = new Map<string, { folio: string; monto: number; compType: string | null; tieneRefund: boolean }[]>();
for (const n of d.invoices) {
  if (n.tipoDoc !== 61 || n.type !== "recibida" || !n.referenceFolioNumber) continue;
  const k = `${String(n.referenceFolioNumber).replace(/^0+/, "")}|${rut8(n.rutIssuer)}`;
  (ncByOrig.get(k) ?? ncByOrig.set(k, []).get(k)!).push({ folio: String(n.folioNumber), monto: n.totalAmount, compType: n.compensationType, tieneRefund: !!n.refundBankMovementId });
}

// facturas recibidas (no NC) por folio+rut
const facByKey = new Map<string, any>();
for (const inv of d.invoices) {
  if (inv.type !== "recibida" || inv.tipoDoc === 61) continue;
  const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`;
  if (k !== "|") facByKey.set(k, inv);
}

// Maxxa: factura(folio+rut) → movimientos imputados
const maxxaFiles = [
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 48, 52, 56].includes(parseInt(td, 10));
const maxxaByFac = new Map<string, { sum: number; movs: { date: string; abono: number; desc: string }[] }>();
const seenIdPago = new Set<string>(); // dedup: los 2 archivos se solapan (jul 14-17)
for (const f of maxxaFiles) {
  const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[4] === "" || !r[27]) continue;
    let arr: any[] = [];
    try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { continue; }
    for (const a of arr) {
      if (!isRealDte(String(a.TipoDoc))) continue;
      const idPago = String(a.id_pago ?? "");
      if (idPago && seenIdPago.has(idPago)) continue;
      if (idPago) seenIdPago.add(idPago);
      const k = `${String(a.Folio ?? "").replace(/^0+/, "")}|${rut8(a.Rut)}`;
      const g = maxxaByFac.get(k) ?? { sum: 0, movs: [] };
      g.sum += Math.abs(Number(a.Abono) || 0);
      g.movs.push({ date: String(r[7]).slice(0, 10), abono: Math.abs(Number(a.Abono) || 0), desc: String(r[3] ?? "").slice(0, 32) });
      maxxaByFac.set(k, g);
    }
  }
}

// recorrer todas las facturas con imputación (app o Maxxa) y detectar sobre-imputación
const tol = 50;
type Row = { folio: string; proveedor: string; obra: string; total: number; ncMonto: number; neto: number; appPaid: number; maxxaSum: number; excesoVsTotal: number; tieneNC: string; nMovsMaxxa: number; detalle: string };
const rows: Row[] = [];
const keys = new Set<string>([...facByKey.keys()].filter((k) => appPays.has(facByKey.get(k).id) || maxxaByFac.has(k)));
for (const k of keys) {
  const inv = facByKey.get(k);
  const appPaid = (appPays.get(inv.id) ?? []).reduce((s, p) => s + p.amount, 0);
  const mx = maxxaByFac.get(k);
  const maxxaSum = mx?.sum ?? 0;
  const imputado = Math.max(appPaid, maxxaSum);
  if (imputado <= inv.totalAmount + tol) continue; // solo sobre-imputadas
  const ncs = ncByOrig.get(k) ?? [];
  const ncMonto = ncs.reduce((s, n) => s + n.monto, 0);
  rows.push({
    folio: String(inv.folioNumber), proveedor: inv.businessName ?? "", obra: inv.projectId ? (projName.get(inv.projectId) ?? "?") : "(sin obra)",
    total: inv.totalAmount, ncMonto, neto: inv.totalAmount - ncMonto, appPaid, maxxaSum,
    excesoVsTotal: imputado - inv.totalAmount,
    tieneNC: ncs.length ? `sí (folio ${ncs.map((n) => n.folio).join(",")}, ${ncs.map((n) => n.compType ?? "sin-comp").join(",")})` : "NO",
    nMovsMaxxa: mx?.movs.length ?? 0,
    detalle: mx ? mx.movs.map((m) => `${m.date} ${fmt(m.abono)}`).join(" + ") : "",
  });
}
rows.sort((a, b) => b.excesoVsTotal - a.excesoVsTotal);

console.log(`\n${"#".repeat(80)}`);
console.log(`SOBRE-IMPUTACIÓN: facturas con MÁS plata imputada que su total (app o Maxxa)`);
console.log(`${"#".repeat(80)}\n`);
console.log(`${rows.length} facturas. De esas, con NC detrás: ${rows.filter((r) => r.tieneNC !== "NO").length}, sin NC: ${rows.filter((r) => r.tieneNC === "NO").length}\n`);
console.log("folio        proveedor                       obra                  total        exceso      app pagó    Maxxa imp.   NC?");
for (const r of rows) {
  console.log(
    `${r.folio.padEnd(11)}  ${r.proveedor.slice(0, 30).padEnd(30)}  ${r.obra.slice(0, 20).padEnd(20)}  ${fmt(r.total).padStart(11)}  ${fmt(r.excesoVsTotal).padStart(10)}  ${fmt(r.appPaid).padStart(11)}  ${fmt(r.maxxaSum).padStart(11)}  ${r.tieneNC}`
  );
}
console.log(`\nExceso total imputado por sobre el valor de las facturas: ${fmt(rows.reduce((s, r) => s + r.excesoVsTotal, 0))}`);

// Excel con el detalle de movimientos
const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
  Folio: r.folio, Proveedor: r.proveedor, Obra: r.obra, "Total factura": r.total,
  "NC monto": r.ncMonto, "Neto (total-NC)": r.neto, "App pagó": r.appPaid, "Maxxa imputó": r.maxxaSum,
  "Exceso vs total": r.excesoVsTotal, "Tiene NC": r.tieneNC, "Movs Maxxa (detalle)": r.detalle,
})));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Sobre-imputacion");
const outPath = join(homedir(), "Downloads", "Sobre_imputacion_y_NC.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`\nExcel (con detalle de movimientos): ${outPath}`);
