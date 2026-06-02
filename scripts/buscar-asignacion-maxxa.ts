// READ-ONLY: busca en los Excel de conciliación de Maxxa a qué factura asignó MJ
// cada uno de los movimientos que quedaron abiertos en la app. La columna de
// asignación de Maxxa (folio+rut+abono+tipoDoc por movimiento) es la verdad
// manual de MJ. Cruza cada asignación contra las facturas de la app.
//
// NO toca la BD (solo lee el dump + los xlsx). Uso:
//   npx tsx scripts/buscar-asignacion-maxxa.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);

// índice de facturas de la app (folio|rut → factura) desde el dump más reciente
const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir).filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json")).sort().pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));
const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.id]));
const appInv = new Map<string, any>();
for (const inv of d.invoices) {
  const fol = String(inv.folioNumber ?? "").replace(/^0+/, "");
  const rut = rut8(inv.rutIssuer);
  if (fol && rut) appInv.set(`${inv.type}|${fol}|${rut}`, inv);
}

// movimientos abiertos a investigar (glosa, |monto|)
const targets: { label: string; amount: number; key: string }[] = [
  { label: "Icproyectos 07-may", amount: 1208015, key: "icproyec" },
  { label: "Icproyectos 12-feb", amount: 1000000, key: "icproyec" },
  { label: "Icproyectos 17-feb", amount: 5069000, key: "icproyec" },
  { label: "Cuadros 03-abr", amount: 395000, key: "cuadros" },
  { label: "Cuadros 12-jun", amount: 395000, key: "cuadros" },
  { label: "Nelson Gil 05-jun", amount: 130000, key: "nelson gil" },
  { label: "Nelson Gil 16-jun", amount: 179400, key: "nelson gil" },
  { label: "MercadoPago 30-may", amount: 37389, key: "mercadopago" },
  { label: "BLARQ SPA 17-nov a", amount: 3146785, key: "blarq spa" },
  { label: "BLARQ SPA 17-nov b", amount: 380677, key: "blarq spa" },
  { label: "BLARQ SPA 26-nov", amount: 862500, key: "blarq spa" },
  { label: "BLARQ SPA 06-abr", amount: 800000, key: "blarq spa" },
];

// leer las dos cartolas Maxxa, dedup por id_pago
const maxxaFiles = [
  "/Users/mjblanco/Downloads/MovimientosCartola_20260601_1722.xlsx", // ene–mar 2025 (nuevo, llena el hueco)
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
  "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
];
type Row = { date: string; amount: number; desc: string; asigns: any[] };
const rows: Row[] = [];
const seen = new Set<string>();
for (const f of maxxaFiles) {
  const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (r[4] === "") continue;
    let arr: any[] = [];
    if (r[27]) { try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { arr = []; } }
    // dedup por id_pago de la primera asignación (o por fila si no hay)
    const idp = arr[0]?.id_pago ? String(arr[0].id_pago) : `row-${r[3]}-${r[4]}-${r[7]}`;
    if (seen.has(idp)) continue;
    seen.add(idp);
    rows.push({ date: String(r[7]).slice(0, 10), amount: Math.abs(Number(r[4]) || 0), desc: String(r[3] ?? ""), asigns: arr });
  }
}

const tdName: Record<string, string> = { "33": "factura", "34": "factura exenta", "61": "nota de crédito", "1043": "mano de obra (sin DTE)", "1051": "impuestos", "1054": "retiro/socios", "1039": "honorarios", "1040": "honorarios" };

console.log(`Dump: ${dumpFile}\n${"#".repeat(76)}\nQué factura asignó MJ en Maxxa a cada movimiento abierto\n${"#".repeat(76)}\n`);
for (const t of targets) {
  const matches = rows.filter((r) => r.amount === t.amount && r.desc.toLowerCase().includes(t.key));
  console.log(`■ ${t.label} — ${fmt(t.amount)}`);
  if (!matches.length) { console.log(`   (no aparece en la cartola Maxxa — fuera de rango mar–dic 2025, o no conciliado)\n`); continue; }
  for (const m of matches) {
    if (!m.asigns.length) { console.log(`   ${m.date}: Maxxa NO le asignó factura (quedó sin conciliar en Maxxa)`); continue; }
    for (const a of m.asigns) {
      const fol = String(a.Folio ?? "").replace(/^0+/, "");
      const rut = rut8(a.Rut);
      const td = String(a.TipoDoc);
      // buscar la factura en la app (recibida o emitida)
      const rec = appInv.get(`recibida|${fol}|${rut}`);
      const emi = appInv.get(`emitida|${fol}|${rut}`);
      const inv = rec ?? emi;
      const enApp = inv ? `→ app: ${inv.type} f${fol} ${(inv.businessName ?? "").slice(0, 24)} ${fmt(inv.totalAmount)} [${inv.status}] obra:${inv.projectId ? projName.get(inv.projectId) : "-"}` : `→ NO está en la app (folio ${fol} rut ${rut})`;
      console.log(`   ${m.date}: Maxxa → ${tdName[td] ?? "tipoDoc " + td} folio ${fol} · ${a.NomAux ?? ""} · ${fmt(Math.abs(Number(a.Abono) || 0))}`);
      console.log(`             ${enApp}`);
    }
  }
  console.log("");
}
