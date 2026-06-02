// READ-ONLY: ¿se traspasó bien la conciliación de Maxxa a la app?
//
// Da vuelta la cartola Maxxa (cada fila = un movimiento con su Asignacion =
// folio+RUT que paga) para reconstruir, por FACTURA, qué movimientos le
// imputó Maxxa. Luego compara contra los pagos (InvoicePayment) que esa
// factura tiene en la app. Marca dónde la app tiene MENOS de lo que Maxxa
// concilió (broche faltante = movimiento suelto en sin_asignar).
//
// NO toca la BD. Lee el dump JSON + los MovimientosCartola_*.xlsx.
// Uso: npx tsx scripts/verificar-traspaso-conciliacion.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";

const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir).filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json")).sort().pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));

// índice app: factura recibida por folio+rut(8) → {inv, pagado}
const paidBy = new Map<string, number>();
for (const p of d.invoicePayments) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.amountApplied);
const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.alias ?? p.id]));
const appInv = new Map<string, any>();
for (const inv of d.invoices) {
  if (inv.type !== "recibida") continue;
  const fol = String(inv.folioNumber ?? "").replace(/^0+/, "");
  const rut = (inv.rutIssuer ?? "").replace(/\D/g, "").slice(-8);
  if (fol && rut) appInv.set(`${fol}|${rut}`, inv);
}

// Maxxa Operativa → factura(folio+rut) → movimientos imputados
const maxxaFiles = [
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 48, 52, 56, 61].includes(parseInt(td, 10));
type MxPay = { folio: string; rut: string; tipoDoc: string; abono: number; nom: string; movDesc: string; movDate: string; movAbs: number };
const maxxaPays: MxPay[] = [];
const seenIdPago = new Set<string>(); // dedup: los 2 archivos se solapan (jul 14-17)
for (const f of maxxaFiles) {
  const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[4] === "" || !r[27]) continue;
    let arr: any[] = [];
    try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { continue; }
    for (const a of arr) {
      const idPago = String(a.id_pago ?? "");
      if (idPago && seenIdPago.has(idPago)) continue; // ya contado desde el otro archivo
      if (idPago) seenIdPago.add(idPago);
      maxxaPays.push({
        folio: String(a.Folio ?? "").replace(/^0+/, ""),
        rut: String(a.Rut ?? "").replace(/\D/g, "").slice(-8),
        tipoDoc: String(a.TipoDoc),
        abono: Math.abs(Number(a.Abono) || 0),
        nom: a.NomAux ?? "",
        movDesc: String(r[3] ?? ""), movDate: String(r[7]).slice(0, 10), movAbs: Math.abs(Number(r[4]) || 0),
      });
    }
  }
}

// agrupar por factura (solo DTE reales)
type Grp = { folio: string; rut: string; nom: string; maxxaSum: number; movs: MxPay[] };
const byFactura = new Map<string, Grp>();
for (const p of maxxaPays) {
  if (!isRealDte(p.tipoDoc) || !p.rut || !p.folio) continue;
  const k = `${p.folio}|${p.rut}`;
  const g = byFactura.get(k) ?? { folio: p.folio, rut: p.rut, nom: p.nom, maxxaSum: 0, movs: [] };
  g.maxxaSum += p.abono; g.movs.push(p);
  byFactura.set(k, g);
}

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const tol = 50; // tolerancia $50
type Out = { folio: string; rut: string; nom: string; obra: string; total: number; maxxaPaid: number; appPaid: number; gap: number; appStatus: string; nMaxxa: number; nApp: number; clase: string };
const out: Out[] = [];
let noEnApp = 0;
for (const [k, g] of byFactura) {
  const inv = appInv.get(k);
  if (!inv) { noEnApp++; continue; }
  const appPaid = paidBy.get(inv.id) ?? 0;
  const nApp = d.invoicePayments.filter((p: any) => p.invoiceId === inv.id).length;
  const gap = g.maxxaSum - appPaid;
  let clase = "OK";
  if (gap > tol) clase = "APP_FALTA";       // Maxxa pagó más → broche faltante en la app
  else if (gap < -tol) clase = "APP_MAS";   // app tiene más que Maxxa
  out.push({
    folio: g.folio, rut: g.rut, nom: inv.businessName ?? g.nom,
    obra: inv.projectId ? (projName.get(inv.projectId) ?? "?") : "(sin obra)",
    total: inv.totalAmount, maxxaPaid: g.maxxaSum, appPaid, gap, appStatus: inv.status,
    nMaxxa: g.movs.length, nApp, clase,
  });
}

const falta = out.filter((o) => o.clase === "APP_FALTA").sort((a, b) => b.gap - a.gap);
const mas = out.filter((o) => o.clase === "APP_MAS");
const ok = out.filter((o) => o.clase === "OK");

console.log(`\n${"#".repeat(74)}`);
console.log(`¿SE TRASPASÓ BIEN LA CONCILIACIÓN DE MAXXA? (cuenta Operativa, mar-dic 2025)`);
console.log(`${"#".repeat(74)}`);
console.log(`\nFacturas que Maxxa concilió (al menos 1 mov imputado, DTE real): ${byFactura.size}`);
console.log(`  - de esas, NO están en la app: ${noEnApp}`);
console.log(`  - en la app y bien traspasadas (mismo pagado ±$50): ${ok.length} · ${fmt(ok.reduce((s, o) => s + o.appPaid, 0))}`);
console.log(`  - en la app pero la APP TIENE MENOS pagado que Maxxa (broche faltante): ${falta.length} · falta enganchar ${fmt(falta.reduce((s, o) => s + o.gap, 0))}`);
console.log(`  - app tiene MÁS que Maxxa (revisar): ${mas.length}`);

console.log(`\n--- Las que faltan enganchar (Maxxa las pagó, la app no las tiene completas) ---`);
console.log(`folio        proveedor                       obra                     total       Maxxa pagó    app pagó     falta     estado app   movs(Mx/app)`);
for (const o of falta) {
  console.log(
    `${o.folio.padEnd(11)}  ${o.nom.slice(0, 30).padEnd(30)}  ${o.obra.slice(0, 22).padEnd(22)}  ${fmt(o.total).padStart(11)}  ${fmt(o.maxxaPaid).padStart(11)}  ${fmt(o.appPaid).padStart(11)}  ${fmt(o.gap).padStart(10)}  ${o.appStatus.padEnd(9)}  ${o.nMaxxa}/${o.nApp}`
  );
}
console.log(`\nTotal a enganchar (suma de lo que falta): ${fmt(falta.reduce((s, o) => s + o.gap, 0))} en ${falta.length} facturas`);

// Excel
const ws = XLSX.utils.json_to_sheet(
  [...falta, ...mas, ...ok].map((o) => ({
    Clase: o.clase, Folio: o.folio, Proveedor: o.nom, Obra: o.obra, "Total factura": o.total,
    "Maxxa pagó": o.maxxaPaid, "App pagó": o.appPaid, "Falta enganchar": o.gap,
    "Estado app": o.appStatus, "Movs Maxxa": o.nMaxxa, "Pagos app": o.nApp,
  }))
);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Traspaso conciliacion");
const outPath = join(homedir(), "Downloads", "Traspaso_conciliacion_Maxxa_vs_app.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`\nExcel: ${outPath}`);
