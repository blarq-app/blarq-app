// READ-ONLY: lista detallada de los movimientos sin_asignar de la app que
// Maxxa tenía atados a una factura electrónica que HOY sigue pendiente/parcial
// en la app (candidatos a re-enganche directo). Imprime tabla + escribe Excel
// en ~/Downloads. NO toca la BD.
//
// Uso: npx tsx scripts/listar-reenganche-57.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";

const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir).filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json")).sort().pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));

type Mov = { id: string; date: string; description: string; amount: number; counterpartyRut: string | null; status: string; bankAccountId: string };
const appPend: Mov[] = d.bankMovements.filter((m: Mov) => m.status === "sin_asignar" && m.bankAccountId === "ba_op_blarq");

// índices app
const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.alias ?? p.id]));
const catName = new Map<string, string>(d.costCategories.map((c: any) => [c.id, c.name ?? c.id]));
const paidBy = new Map<string, number>();
for (const p of d.invoicePayments) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.amountApplied);
// índice por folio+RUT (llave real de un DTE; el folio solo choca entre emisores)
const appByFolioRut = new Map<string, any>();
for (const inv of d.invoices) {
  if (inv.type !== "recibida") continue;
  const fol = String(inv.folioNumber ?? "").replace(/^0+/, "");
  const rut = (inv.rutIssuer ?? "").replace(/\D/g, "").slice(-8);
  if (fol && rut) appByFolioRut.set(`${fol}|${rut}`, inv);
}

// Maxxa Operativa
const maxxaFiles = [
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
type MxRow = { abs: number; date: string; rut: string; estado: string; tipoDocs: string[]; folios: string[]; nom: string; asigns: { folio: string; rut: string; tipoDoc: string }[] };
const mx: MxRow[] = [];
for (const f of maxxaFiles) {
  const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[4] === "") continue;
    let tipoDocs: string[] = [], folios: string[] = [], nom = "";
    let asigns: { folio: string; rut: string; tipoDoc: string }[] = [];
    try {
      const arr = JSON.parse(String(r[27]).split(";")[0]);
      tipoDocs = arr.map((a: any) => String(a.TipoDoc));
      folios = arr.map((a: any) => String(a.Folio));
      nom = arr[0]?.NomAux ?? "";
      asigns = arr.map((a: any) => ({ folio: String(a.Folio).replace(/^0+/, ""), rut: String(a.Rut ?? "").replace(/\D/g, "").slice(-8), tipoDoc: String(a.TipoDoc) }));
    } catch {}
    mx.push({ abs: Math.abs(Number(r[4]) || 0), date: String(r[7]).slice(0, 10), rut: String(r[10] || r[13] || "").replace(/\D/g, ""), estado: String(r[25]), tipoDocs, folios, nom, asigns });
  }
}
const mxDates = mx.map((m) => m.date).sort();
const [mxMin, mxMax] = [mxDates[0], mxDates[mxDates.length - 1]];
const within = (a: string, b: string, days: number) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 <= days;
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 48, 52, 56, 61].includes(parseInt(td, 10));

// armar las filas de re-enganche
type Out = { fecha: string; monto: number; proveedor: string; folio: string; obra: string; categoria: string; facturaTotal: number; facturaSaldo: number; facturaStatus: string; sobrepasa: string; glosaBanco: string; rutMovCalza: string };
const out: Out[] = [];
for (const mov of appPend) {
  const ad = mov.date.slice(0, 10);
  if (ad < mxMin || ad > mxMax) continue;
  const abs = Math.abs(mov.amount);
  const movRut = (mov.counterpartyRut ?? "").replace(/\D/g, "");
  let cands = mx.filter((m) => Math.abs(m.abs - abs) <= 1 && within(m.date, ad, 3));
  if (cands.length > 1 && movRut) { const byRut = cands.filter((m) => m.rut && (m.rut.includes(movRut.slice(-8)) || movRut.includes(m.rut.slice(-8)))); if (byRut.length) cands = byRut; }
  if (!cands.length) continue;
  const m = cands[0];
  if (m.estado === "Pendiente" || !m.tipoDocs.some(isRealDte)) continue;
  // buscar la factura citada por FOLIO+RUT que siga pendiente/parcial en la app
  let inv: any = null;
  for (const a of m.asigns) {
    if (!isRealDte(a.tipoDoc) || !a.rut) continue;
    const hit = appByFolioRut.get(`${a.folio}|${a.rut}`);
    if (hit && (hit.status === "pendiente" || hit.status === "parcial")) { inv = hit; break; }
  }
  if (!inv) continue;
  const saldo = inv.totalAmount - (paidBy.get(inv.id) ?? 0);
  const invRut = (inv.rutIssuer ?? "").replace(/\D/g, "");
  out.push({
    fecha: ad, monto: abs, proveedor: inv.businessName ?? m.nom, folio: String(inv.folioNumber),
    obra: inv.projectId ? (projName.get(inv.projectId) ?? "?") : "(sin obra)",
    categoria: inv.categoryId ? (catName.get(inv.categoryId) ?? "?") : "(sin categoría)",
    facturaTotal: inv.totalAmount, facturaSaldo: saldo, facturaStatus: inv.status,
    sobrepasa: abs > saldo + 10 ? "SÍ — el mov supera el saldo" : "",
    glosaBanco: mov.description.slice(0, 40),
    rutMovCalza: movRut && invRut ? (movRut.includes(invRut.slice(-8)) || invRut.includes(movRut.slice(-8)) ? "sí" : "NO") : "(sin rut mov)",
  });
}
// tier: LIMPIO = no supera saldo y el RUT del banco calza (o Maxxa lo aseguró por folio+rut)
const tierOf = (o: Out) => {
  if (o.sobrepasa) return "REVISAR";        // mov supera el saldo → multi-transfer / ya pagada
  if (o.rutMovCalza === "NO") return "REVISAR"; // RUT del banco contradice
  if (o.rutMovCalza === "sí") return "LIMPIO";  // calza por los dos lados
  return "PROBABLE";                          // cabe en saldo; sin rut en el banco pero Maxxa lo ató por folio+rut
};
for (const o of out) (o as any).tier = tierOf(o);
const order = { LIMPIO: 0, PROBABLE: 1, REVISAR: 2 } as Record<string, number>;
out.sort((a, b) => order[(a as any).tier] - order[(b as any).tier] || a.proveedor.localeCompare(b.proveedor) || a.fecha.localeCompare(b.fecha));

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
console.log(`\nMovs sin_asignar que Maxxa tenía en una factura recibida HOY pendiente/parcial: ${out.length}\n`);
console.log("tier      fecha       monto         proveedor                        folio        obra                      saldo fact   rut");
for (const o of out) {
  console.log(
    `${(o as any).tier.padEnd(8)}  ${o.fecha}  ${fmt(o.monto).padStart(12)}  ${o.proveedor.slice(0, 30).padEnd(30)}  ${o.folio.padEnd(11)}  ${o.obra.slice(0, 22).padEnd(22)}  ${fmt(o.facturaSaldo).padStart(11)}  ${o.rutMovCalza}`
  );
}
const limpio = out.filter((o) => (o as any).tier === "LIMPIO");
const probable = out.filter((o) => (o as any).tier === "PROBABLE");
const revisar = out.filter((o) => (o as any).tier === "REVISAR");
console.log(`\n  LIMPIO  (cabe en el saldo + RUT calza por los dos lados): ${limpio.length} movs · ${fmt(limpio.reduce((s, o) => s + o.monto, 0))}`);
console.log(`  PROBABLE(cabe en el saldo; sin RUT en el banco pero Maxxa lo ató por folio+rut): ${probable.length} movs · ${fmt(probable.reduce((s, o) => s + o.monto, 0))}`);
console.log(`  REVISAR (el mov supera el saldo = Maxxa pegó varias transferencias a esa factura / ya pagada): ${revisar.length} movs · ${fmt(revisar.reduce((s, o) => s + o.monto, 0))}`);

// Excel
const ws = XLSX.utils.json_to_sheet(out.map((o) => ({
  Tier: (o as any).tier, Fecha: o.fecha, "Monto mov": o.monto, Proveedor: o.proveedor, Folio: o.folio, Obra: o.obra, Categoría: o.categoria,
  "Total factura": o.facturaTotal, "Saldo factura": o.facturaSaldo, "Estado factura": o.facturaStatus,
  "RUT banco calza": o.rutMovCalza, Alerta: o.sobrepasa, "Glosa banco": o.glosaBanco,
})));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Re-enganche");
const outPath = join(homedir(), "Downloads", "Reenganche_Maxxa_Operativa_2025.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`\nExcel: ${outPath}`);
