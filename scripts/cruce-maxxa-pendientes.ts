// Cruce READ-ONLY: movimientos "sin_asignar" de la app  vs  qué hizo Maxxa
// con ese mismo movimiento. Responde: de lo que en la app quedó pendiente,
// ¿cuánto Maxxa lo tenía atado a una FACTURA REAL (hueco de migración) y
// cuánto a un documento interno (impuesto/sueldo/mano de obra = gasto sin
// factura, no es hueco)?
//
// NO toca la BD. Lee el dump JSON de la app + los MovimientosCartola_*.xlsx
// de Maxxa. No escribe nada.
//
// Uso: npx tsx scripts/cruce-maxxa-pendientes.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

// ── dump app ───────────────────────────────────────────────────────────────
const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir)
  .filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json"))
  .sort()
  .pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));
console.log(`App dump: ${dumpFile} (${d.meta?.generatedAt})`);

type Mov = { id: string; date: string; description: string; amount: number; counterpartyRut: string | null; status: string; bankAccountId: string };
const appPend: Mov[] = d.bankMovements.filter(
  (m: Mov) => m.status === "sin_asignar" && m.bankAccountId === "ba_op_blarq"
);

// ── cartolas Maxxa (cuenta Operativa 89134595) ──────────────────────────────
const maxxaFiles = [
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
type MxRow = { desc: string; abs: number; date: string; rut: string; estado: string; tipoDocs: string[]; folios: string[]; nom: string };
const mx: MxRow[] = [];
for (const f of maxxaFiles) {
  const wb = XLSX.readFile(f);
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[4] === "") continue;
    let tipoDocs: string[] = [], folios: string[] = [], nom = "";
    const asig = String(r[27] ?? "");
    if (asig) {
      try {
        const arr = JSON.parse(asig.split(";")[0]);
        tipoDocs = arr.map((a: any) => String(a.TipoDoc));
        folios = arr.map((a: any) => String(a.Folio));
        nom = arr[0]?.NomAux ?? "";
      } catch {}
    }
    mx.push({
      desc: String(r[3] ?? ""),
      abs: Math.abs(Number(r[4]) || 0),
      date: String(r[7] ?? "").slice(0, 10),
      rut: String(r[10] || r[13] || "").replace(/\D/g, ""),
      estado: String(r[25] ?? ""),
      tipoDocs, folios, nom,
    });
  }
}
const mxDates = mx.map((m) => m.date).filter(Boolean).sort();
console.log(`Maxxa: ${mx.length} movs, cuenta Operativa, ${mxDates[0]} → ${mxDates[mxDates.length - 1]}\n`);

// ── matching app mov ↔ Maxxa row (monto abs + fecha ±3d, desempata por RUT) ──
const within = (a: string, b: string, days: number) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 <= days;

// DTE reales (factura/boleta/NC/etc). Lo que sea TipoDoc 1000+ es interno Maxxa.
const isRealDte = (td: string) => {
  const n = parseInt(td, 10);
  return [33, 34, 39, 41, 43, 46, 48, 52, 56, 61, 110, 111, 112].includes(n);
};

const buckets = {
  factura_real: [] as { mov: Mov; mx: MxRow }[], // Maxxa lo ató a una factura/boleta real → HUECO
  interno: [] as { mov: Mov; mx: MxRow }[], // Maxxa lo ató a doc interno (impuesto/sueldo/mano obra)
  maxxa_pendiente: [] as { mov: Mov; mx: MxRow }[], // Maxxa tampoco lo asignó
  fuera_ventana: [] as Mov[], // app mov fuera del rango de fechas que cubre Maxxa
  sin_match_maxxa: [] as Mov[], // dentro de ventana pero no encontré la fila en Maxxa
};

const mxMin = mxDates[0], mxMax = mxDates[mxDates.length - 1];
for (const mov of appPend) {
  const ad = mov.date.slice(0, 10);
  if (ad < mxMin || ad > mxMax) { buckets.fuera_ventana.push(mov); continue; }
  const abs = Math.abs(mov.amount);
  const movRut = (mov.counterpartyRut ?? "").replace(/\D/g, "");
  let cands = mx.filter((m) => Math.abs(m.abs - abs) <= 1 && within(m.date, ad, 3));
  if (cands.length > 1 && movRut) {
    const byRut = cands.filter((m) => m.rut && (m.rut.includes(movRut.slice(-8)) || movRut.includes(m.rut.slice(-8))));
    if (byRut.length) cands = byRut;
  }
  if (cands.length === 0) { buckets.sin_match_maxxa.push(mov); continue; }
  const m = cands[0];
  if (m.estado === "Pendiente" || m.tipoDocs.length === 0) buckets.maxxa_pendiente.push({ mov, mx: m });
  else if (m.tipoDocs.some(isRealDte)) buckets.factura_real.push({ mov, mx: m });
  else buckets.interno.push({ mov, mx: m });
}

// ── reporte ──────────────────────────────────────────────────────────────
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const sumMov = (a: { mov: Mov }[] | Mov[]) =>
  (a as any[]).reduce((s, x) => s + Math.abs((x.mov ?? x).amount), 0);

console.log(`${"#".repeat(72)}`);
console.log(`CRUCE: ${appPend.length} movs sin_asignar de la app (cuenta Operativa) vs Maxxa`);
console.log(`${"#".repeat(72)}\n`);

console.log(`Dentro del rango que cubre Maxxa (${mxMin} → ${mxMax}):`);
console.log(`  1) HUECO REAL — Maxxa lo tenía atado a una FACTURA/BOLETA real (TipoDoc DTE):`);
console.log(`       ${buckets.factura_real.length} movs · ${fmt(sumMov(buckets.factura_real))}  ← esto puedo recuperar`);
console.log(`  2) GASTO SIN FACTURA — Maxxa lo ató a doc INTERNO (impuesto/sueldo/mano de obra):`);
console.log(`       ${buckets.interno.length} movs · ${fmt(sumMov(buckets.interno))}`);
console.log(`  3) Maxxa TAMPOCO lo asignó (Pendiente allá también):`);
console.log(`       ${buckets.maxxa_pendiente.length} movs · ${fmt(sumMov(buckets.maxxa_pendiente))}`);
console.log(`  4) No encontré ese mov en la cartola Maxxa (revisar):`);
console.log(`       ${buckets.sin_match_maxxa.length} movs · ${fmt(sumMov(buckets.sin_match_maxxa))}`);
console.log(`\nFuera del rango de Maxxa (ene-feb 2025 + 2026, Maxxa no los tiene):`);
console.log(`       ${buckets.fuera_ventana.length} movs · ${fmt(sumMov(buckets.fuera_ventana))}`);

// desglose del bucket 2 (interno) por TipoDoc
const porTipo: Record<string, { n: number; tot: number }> = {};
for (const { mov, mx: m } of buckets.interno) {
  const td = m.tipoDocs[0] ?? "?";
  porTipo[td] = porTipo[td] || { n: 0, tot: 0 };
  porTipo[td].n++; porTipo[td].tot += Math.abs(mov.amount);
}
const tipoNombre: Record<string, string> = { "1043": "mano de obra sin DTE", "1051": "impuesto (Tesorería/SII)", "1054": "retiro/transferencia socio", "1050": "interno", "1052": "interno", "1053": "interno" };
console.log(`\n   detalle del grupo 2 (interno) por TipoDoc Maxxa:`);
for (const [td, v] of Object.entries(porTipo).sort((a, b) => b[1].n - a[1].n))
  console.log(`     TipoDoc ${td} (${tipoNombre[td] ?? "interno/otro"}): ${v.n} movs · ${fmt(v.tot)}`);

// desglose del bucket 1 por TipoDoc
const porTipo1: Record<string, { n: number; tot: number }> = {};
for (const { mov, mx: m } of buckets.factura_real) {
  const td = m.tipoDocs.find(isRealDte) ?? m.tipoDocs[0] ?? "?";
  porTipo1[td] = porTipo1[td] || { n: 0, tot: 0 };
  porTipo1[td].n++; porTipo1[td].tot += Math.abs(mov.amount);
}
const tdName: Record<string, string> = { "33": "factura electrónica", "34": "factura exenta", "39": "boleta", "41": "boleta exenta", "46": "factura de compra", "61": "nota crédito", "56": "nota débito" };
console.log(`\n   detalle del grupo 1 (factura real) por TipoDoc:`);
for (const [td, v] of Object.entries(porTipo1).sort((a, b) => b[1].n - a[1].n))
  console.log(`     TipoDoc ${td} (${tdName[td] ?? "?"}): ${v.n} movs · ${fmt(v.tot)}`);

// ¿la factura que cita Maxxa EXISTE en la app? (por folio + rut)
const appByFolio = new Map<string, any[]>();
for (const inv of d.invoices) {
  const fol = String(inv.folioNumber ?? "").replace(/^0+/, "");
  if (fol) (appByFolio.get(fol) ?? appByFolio.set(fol, []).get(fol)!).push(inv);
}
let existeEnApp = 0, existePend = 0, noExiste = 0;
const noExisteList: { mov: Mov; mx: MxRow }[] = [];
for (const { mov, mx: m } of buckets.factura_real) {
  const found = m.folios.some((f) => {
    const fol = f.replace(/^0+/, "");
    const hits = appByFolio.get(fol) ?? [];
    return hits.length > 0;
  });
  if (found) {
    existeEnApp++;
    const anyPend = m.folios.some((f) => (appByFolio.get(f.replace(/^0+/, "")) ?? []).some((i: any) => i.status === "pendiente" || i.status === "parcial"));
    if (anyPend) existePend++;
  } else { noExiste++; noExisteList.push({ mov, mx: m }); }
}
console.log(`\n   ¿la factura que cita Maxxa ya está en la app? (de los ${buckets.factura_real.length} del grupo 1):`);
console.log(`     - SÍ está en la app: ${existeEnApp}  (de esas, ${existePend} aún pendiente/parcial → re-enganche directo)`);
console.log(`     - NO está en la app: ${noExiste}  (habría que traer la factura, tipo migración 1043)`);

console.log(`\n   ej. del grupo 1 — factura SÍ en la app (re-enganche):`);
for (const { mov, mx: m } of buckets.factura_real.filter((x) => m_exists(x, appByFolio)).slice(0, 8))
  console.log(`     ${fmt(Math.abs(mov.amount)).padStart(12)}  ${mov.date.slice(0, 10)}  folio ${m.folios.join(",")}  ${m.nom.slice(0, 30)}`);
console.log(`\n   ej. del grupo 1 — factura NO en la app:`);
for (const { mov, mx: m } of noExisteList.slice(0, 8))
  console.log(`     ${fmt(Math.abs(mov.amount)).padStart(12)}  ${mov.date.slice(0, 10)}  folio ${m.folios.join(",")}  TipoDoc ${m.tipoDocs.join(",")}  ${m.nom.slice(0, 28)}`);

function m_exists(x: { mx: MxRow }, idx: Map<string, any[]>) {
  return x.mx.folios.some((f) => (idx.get(f.replace(/^0+/, "")) ?? []).length > 0);
}
