// DRY-RUN READ-ONLY: qué facturas cambiarían de etiqueta de estado si se
// recalcula según sus pagos reales. NO escribe nada (ni BD ni nada).
//
// Diseño conservador: solo SUBE la etiqueta (pendiente→parcial→pagada cuando
// los pagos lo justifican). NUNCA baja una "pagada" a pendiente (para no
// desmarcar las "pagada sin enlace", que están bien como pagadas y solo les
// falta el broche). Deja afuera las "anulada".
//
// Uso: npx tsx scripts/dryrun-recompute-estado.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";

const dir = join(process.cwd(), "backups");
const dumpFile = readdirSync(dir).filter((f) => f.startsWith("audit-facturas-conciliacion-") && f.endsWith(".json")).sort().pop()!;
const d = JSON.parse(readFileSync(join(dir, dumpFile), "utf8"));
console.log(`Dump: ${dumpFile} (${d.meta?.generatedAt}) — PRE auto-conciliar de hoy; se re-confirma contra prod antes de escribir.\n`);
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const projName = new Map<string, string>(d.projects.map((p: any) => [p.id, p.name ?? p.alias ?? p.id]));
const paid = new Map<string, number>();
const nPays = new Map<string, number>();
for (const p of d.invoicePayments) {
  paid.set(p.invoiceId, (paid.get(p.invoiceId) ?? 0) + p.amountApplied);
  nPays.set(p.invoiceId, (nPays.get(p.invoiceId) ?? 0) + 1);
}

// estado que correspondería según los pagos
const computed = (total: number, s: number) => (s <= 0 ? "pendiente" : s >= total - 1 ? "pagada" : "parcial");
const rank: Record<string, number> = { pendiente: 0, parcial: 1, pagada: 2 };

type Row = { folio: string; proveedor: string; obra: string; total: number; pagado: number; nPagos: number; de: string; a: string };
const aPagada: Row[] = [], aParcial: Row[] = [];
const anuladasConPago: Row[] = [];
for (const inv of d.invoices) {
  if (inv.type !== "recibida" || inv.tipoDoc === 61) continue;
  const s = paid.get(inv.id) ?? 0;
  const want = computed(inv.totalAmount, s);
  const row: Row = {
    folio: String(inv.folioNumber), proveedor: inv.businessName ?? "",
    obra: inv.projectId ? (projName.get(inv.projectId) ?? "?") : "(sin obra)",
    total: inv.totalAmount, pagado: s, nPagos: nPays.get(inv.id) ?? 0, de: inv.status, a: want,
  };
  if (inv.status === "anulada") { if (s > 0) anuladasConPago.push(row); continue; } // nunca tocar anuladas
  // solo SUBIR (want más pagado que el actual). nunca bajar.
  if (rank[want] <= rank[inv.status]) continue;
  if (want === "pagada") aPagada.push(row);
  else if (want === "parcial") aParcial.push(row);
}

const show = (rows: Row[], titulo: string) => {
  console.log(`\n=== ${titulo}: ${rows.length} facturas · ${fmt(rows.reduce((a, r) => a + r.total, 0))} ===`);
  console.log("folio        proveedor                       obra                  total        pagado     de->a");
  for (const r of rows.sort((a, b) => b.total - a.total))
    console.log(`${r.folio.padEnd(11)}  ${r.proveedor.slice(0, 30).padEnd(30)}  ${r.obra.slice(0, 20).padEnd(20)}  ${fmt(r.total).padStart(11)}  ${fmt(r.pagado).padStart(11)}  ${r.de}->${r.a}`);
};
show(aPagada, "A1. Subirían a PAGADA (tienen el pago completo, dicen pendiente/parcial)");
show(aParcial, "A2. Subirían a PARCIAL (tienen pago parcial, dicen pendiente)");

console.log(`\n--- DEJADAS AFUERA a propósito ---`);
console.log(`Anuladas que tienen un pago (NO se tocan): ${anuladasConPago.length} · ${fmt(anuladasConPago.reduce((a, r) => a + r.total, 0))}`);
for (const r of anuladasConPago.slice(0, 10)) console.log(`   ${r.folio.padEnd(10)} ${r.proveedor.slice(0, 28).padEnd(28)} ${fmt(r.total).padStart(11)}  (queda anulada)`);
console.log(`(También quedan intactas las "pagada sin broche" — no se bajan a pendiente.)`);

console.log(`\nTOTAL que cambiaría de etiqueta: ${aPagada.length + aParcial.length} facturas. Cero cambio de plata (solo la etiqueta de estado).`);

const ws = XLSX.utils.json_to_sheet([...aPagada, ...aParcial].map((r) => ({
  Folio: r.folio, Proveedor: r.proveedor, Obra: r.obra, "Total": r.total, "Pagado (imputado)": r.pagado,
  "N° pagos": r.nPagos, "Estado actual": r.de, "Pasaría a": r.a,
})));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Recompute estado (dry-run)");
const outPath = join(homedir(), "Downloads", "DryRun_recompute_estado_grupoA.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`\nExcel para revisar: ${outPath}`);
