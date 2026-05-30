// Lista OFFLINE las conciliaciones (InvoicePayment) con gap de fecha > N dias
// entre el movimiento bancario y la factura imputada. Cero acceso a BD: lee el
// JSON del dump de auditoria.
//
// Uso: npx tsx scripts/list-conciliaciones-dudosas.ts <dump.json> [gapDias=15]
//
// Para cada imputacion con gap > N marca:
//  - si el RUT de la contraparte del mov calza con el rutIssuer de la factura
//  - si existia OTRA factura del mismo monto (±$10) mas cercana en fecha
//    (mismo RUT -> match demostrablemente sub-optimo; distinto RUT -> candidata)

import { readFileSync } from "fs";

type Invoice = {
  id: string; projectId: string | null; type: string; tipoDoc: number | null;
  folioNumber: string | null; rutIssuer: string | null; businessName: string | null;
  issueDate: string; totalAmount: number; status: string; origin: string;
};
type Mov = {
  id: string; date: string; description: string; amount: number;
  counterpartyName: string | null; counterpartyRut: string | null;
};
type Pay = { id: string; bankMovementId: string; invoiceId: string; amountApplied: number };

const file = process.argv[2];
const GAP = Number(process.argv[3] ?? 15);
if (!file) { console.error("Falta path al JSON del dump"); process.exit(1); }

type Reemb = { id: string; nombre: string; glosa: string; personRut: string | null; aliases: { rut: string; businessName: string | null }[] };

const db = JSON.parse(readFileSync(file, "utf8"));
const invoices: Invoice[] = db.invoices;
const movs: Mov[] = db.bankMovements;
const pays: Pay[] = db.invoicePayments;
const projects: { id: string; name: string }[] = db.projects;
const reembs: Reemb[] = db.reembolsadores ?? [];

const invById = new Map(invoices.map(i => [i.id, i]));
const movById = new Map(movs.map(m => [m.id, m]));
const projById = new Map(projects.map(p => [p.id, p]));

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
const tail8 = (s: string | null) => { const d = digits(s); return d.length >= 8 ? d.slice(-8) : d; };
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d10 = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
const proj = (id: string | null) => projById.get(id ?? "")?.name ?? "—";
const norm = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ¿El mov calza con la factura VIA reembolsador? La persona transfiere (su
// personRut o su glosa aparece en el mov) y la factura es de uno de sus alias.
function matchViaReembolsador(mov: Mov, invRutTail: string): { reemb: Reemb } | null {
  if (!invRutTail) return null;
  const movRutTail = tail8(mov.counterpartyRut);
  const movText = norm(`${mov.counterpartyName ?? ""} ${mov.description ?? ""}`);
  for (const r of reembs) {
    const aliasMatch = r.aliases.some(a => tail8(a.rut) === invRutTail);
    if (!aliasMatch) continue;
    const personByRut = !!r.personRut && tail8(r.personRut) === movRutTail;
    const personByGlosa = !!r.glosa && movText.includes(norm(r.glosa));
    const personByName = !!r.nombre && movText.includes(norm(r.nombre));
    if (personByRut || personByGlosa || personByName) return { reemb: r };
  }
  return null;
}

type Row = {
  gap: number; mov: Mov; inv: Invoice;
  rutStatus: "ok" | "reemb" | "mismatch" | "sindato";
  better: Invoice | null; betterGap: number | null; sameRutBetter: boolean;
};

const rows: Row[] = [];
for (const p of pays) {
  const mov = movById.get(p.bankMovementId);
  const inv = invById.get(p.invoiceId);
  if (!mov || !inv) continue;
  const gap = daysBetween(mov.date, inv.issueDate);
  if (gap <= GAP) continue;

  // RUT del mov vs RUT de la factura (recibida = rutIssuer), considerando reembolsadores
  const movRut = tail8(mov.counterpartyRut);
  const invRut = tail8(inv.rutIssuer);
  let rutStatus: Row["rutStatus"];
  if (movRut && invRut && movRut === invRut) rutStatus = "ok";
  else if (matchViaReembolsador(mov, invRut)) rutStatus = "reemb";
  else if (movRut && invRut) rutStatus = "mismatch";
  else rutStatus = "sindato";

  // ¿Existia otra factura del mismo monto (±10) mas cercana en fecha?
  let better: Invoice | null = null, betterGap: number | null = null, sameRutBetter = false;
  for (const o of invoices) {
    if (o.id === inv.id) continue;
    if (o.type !== inv.type) continue;
    if (Math.abs(o.totalAmount - Math.abs(mov.amount)) > 10) continue;
    const g = daysBetween(mov.date, o.issueDate);
    if (g < gap && (betterGap === null || g < betterGap)) {
      better = o; betterGap = g;
      sameRutBetter = !!invRut && tail8(o.rutIssuer) === invRut;
    }
  }
  rows.push({ gap, mov, inv, rutStatus, better, betterGap, sameRutBetter });
}

rows.sort((a, b) => b.gap - a.gap);

// Resumen
const total = rows.length;
const c = (s: Row["rutStatus"]) => rows.filter(r => r.rutStatus === s).length;
const conMejor = rows.filter(r => r.better && r.sameRutBetter).length;

console.log(`\n=== Conciliaciones con gap > ${GAP} dias (mov vs factura) ===`);
console.log(`Dump: ${file}`);
console.log(`Total imputaciones: ${pays.length} | con gap > ${GAP}d: ${total}`);
console.log(`  · RUT NO calza, ni por reembolsador (REVISAR): ${c("mismatch")}`);
console.log(`  · calza via reembolsador (persona->empresa, OK): ${c("reemb")}`);
console.log(`  · sin dato de RUT para comparar: ${c("sindato")}`);
console.log(`  · RUT calza directo: ${c("ok")}`);
console.log(`  · con factura alternativa MISMO RUT+monto mas cercana (match sub-optimo): ${conMejor}\n`);

console.log("FLAGS:  [R!] RUT no calza (revisar)   [Rb] via reembolsador (ok)   [R?] sin RUT   [→] existe factura mas cercana\n");

for (const r of rows) {
  const flags = [
    r.rutStatus === "mismatch" ? "R!" : r.rutStatus === "reemb" ? "Rb" : r.rutStatus === "sindato" ? "R?" : "  ",
    r.sameRutBetter ? "→" : " ",
  ].join(" ");
  const cp = (r.mov.counterpartyName || r.mov.description || "").slice(0, 26).padEnd(26);
  console.log(
    `${flags} gap ${String(Math.round(r.gap)).padStart(3)}d | mov ${d10(r.mov.date)} ${fmt(r.mov.amount).padStart(13)} | ${cp} ` +
    `→ F-${r.inv.folioNumber} ${d10(r.inv.issueDate)} ${(r.inv.businessName || "").slice(0, 20).padEnd(20)} [${proj(r.inv.projectId)}]`
  );
  if (r.better && r.sameRutBetter) {
    console.log(
      `        ↳ existia F-${r.better.folioNumber} ${d10(r.better.issueDate)} (gap ${Math.round(r.betterGap!)}d) mismo RUT/monto [${proj(r.better.projectId)}]`
    );
  }
}
console.log("");
