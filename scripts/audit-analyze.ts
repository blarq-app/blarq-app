// Analizador OFFLINE de la auditoría facturas + conciliación.
// Lee el JSON del dump (cero acceso a BD) y calcula los hallazgos con
// conteos reales. Imprime secciones etiquetadas a stdout.
//
// Uso: npx tsx scripts/audit-analyze.ts backups/audit-facturas-conciliacion-<ts>.json

import { readFileSync } from "fs";

type Invoice = {
  id: string; projectId: string | null; categoryId: string | null;
  type: string; tipoDoc: number | null; folioNumber: string | null;
  rutIssuer: string | null; rutReceiver: string | null; businessName: string | null;
  issueDate: string; dueDate: string | null;
  netAmount: number; iva: number; totalAmount: number;
  status: string; paidAt: string | null; conceptoCobro: string | null;
  referenceFolioNumber: string | null; referenceTipoDoc: number | null;
  compensationType: string | null; appliedToInvoiceId: string | null; refundBankMovementId: string | null;
  origin: string; notes: string | null; createdAt: string; updatedAt: string;
};
type Mov = {
  id: string; bankAccountId: string; date: string; description: string;
  amount: number; type: string; balanceAfter: number | null;
  externalRef: string | null; counterpartyName: string | null; counterpartyRut: string | null;
  category: string | null; internalTransferToId: string | null; status: string;
  notes: string | null; createdAt: string; updatedAt: string;
};
type Pay = { id: string; bankMovementId: string; invoiceId: string; amountApplied: number; createdAt: string };
type Project = { id: string; numeroProyecto: number | null; name: string; isInternal: boolean; status: string };
type Cat = { id: string; name: string; parentId: string | null };
type Reemb = { id: string; nombre: string; glosa: string; personRut: string | null; aliases: { rut: string; businessName: string | null }[] };

const file = process.argv[2];
if (!file) { console.error("Falta path al JSON"); process.exit(1); }
const db = JSON.parse(readFileSync(file, "utf8"));
const invoices: Invoice[] = db.invoices;
const movs: Mov[] = db.bankMovements;
const pays: Pay[] = db.invoicePayments;
const projects: Project[] = db.projects;
const cats: Cat[] = db.costCategories;
const reembs: Reemb[] = db.reembolsadores;

const invById = new Map(invoices.map(i => [i.id, i]));
const movById = new Map(movs.map(m => [m.id, m]));
const projById = new Map(projects.map(p => [p.id, p]));
const catById = new Map(cats.map(c => [c.id, c]));

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
const tail8 = (s: string | null) => { const d = digits(s); return d.length >= 8 ? d.slice(-8) : d; };
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const ym = (iso: string) => iso.slice(0, 7);
const daysBetween = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

// Imputaciones agregadas
const payByInvoice = new Map<string, Pay[]>();
const payByMov = new Map<string, Pay[]>();
for (const p of pays) {
  (payByInvoice.get(p.invoiceId) ?? payByInvoice.set(p.invoiceId, []).get(p.invoiceId)!).push(p);
  (payByMov.get(p.bankMovementId) ?? payByMov.set(p.bankMovementId, []).get(p.bankMovementId)!).push(p);
}
const sumPayInv = (id: string) => (payByInvoice.get(id) ?? []).reduce((s, p) => s + p.amountApplied, 0);
const sumPayMov = (id: string) => (payByMov.get(id) ?? []).reduce((s, p) => s + p.amountApplied, 0);

const H = (t: string) => console.log("\n\n========== " + t + " ==========");
const sub = (t: string) => console.log("\n--- " + t + " ---");

// ════════════════════════════════════════════════════════════════════
H("0. PANORAMA");
console.log(`Facturas: ${invoices.length} | Movimientos: ${movs.length} | Imputaciones: ${pays.length}`);
const byType: Record<string, number> = {};
for (const i of invoices) byType[i.type] = (byType[i.type] ?? 0) + 1;
console.log("Por type:", byType);
const byTipoDoc: Record<string, number> = {};
for (const i of invoices) byTipoDoc[String(i.tipoDoc)] = (byTipoDoc[String(i.tipoDoc)] ?? 0) + 1;
console.log("Por tipoDoc:", byTipoDoc);
const byOrigin: Record<string, number> = {};
for (const i of invoices) byOrigin[i.origin] = (byOrigin[i.origin] ?? 0) + 1;
console.log("Por origin:", byOrigin);
const byStatus: Record<string, number> = {};
for (const i of invoices) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
console.log("Por status factura:", byStatus);
const movByStatus: Record<string, number> = {};
for (const m of movs) movByStatus[m.status] = (movByStatus[m.status] ?? 0) + 1;
console.log("Por status mov:", movByStatus);

// ════════════════════════════════════════════════════════════════════
H("FOCO 1 — ±15 DIAS: codigo vs comentario en auto-match");
console.log("Codigo: import/route.ts paso 5 y tryAutoMatch* NO filtran por fecha.");
console.log("El query solo usa type+status+tipoDoc+totalAmount, y desambigua por RUT.");
console.log("La ventana ±15 dias del header del import y del modal es SOLO marca visual.");

sub("1a. Distribucion del gap (mov.date vs invoice.issueDate) en imputaciones conciliadas");
const gaps: { gap: number; pay: Pay; mov: Mov; inv: Invoice }[] = [];
for (const p of pays) {
  const m = movById.get(p.bankMovementId); const inv = invById.get(p.invoiceId);
  if (!m || !inv) continue;
  gaps.push({ gap: daysBetween(m.date, inv.issueDate), pay: p, mov: m, inv });
}
const buckets = { "<=15": 0, "16-30": 0, "31-60": 0, "61-90": 0, ">90": 0 };
for (const g of gaps) {
  if (g.gap <= 15) buckets["<=15"]++; else if (g.gap <= 30) buckets["16-30"]++;
  else if (g.gap <= 60) buckets["31-60"]++; else if (g.gap <= 90) buckets["61-90"]++; else buckets[">90"]++;
}
console.log("Imputaciones con gap mov↔factura:", buckets, `(total ${gaps.length})`);
const farGaps = gaps.filter(g => g.gap > 15).sort((a, b) => b.gap - a.gap);
console.log(`Imputaciones con gap > 15 dias (la "tolerancia" comentada): ${farGaps.length}`);

sub("1b. Casos donde el gap es grande Y existia otra factura del MISMO monto+RUT mas cercana en fecha (match pudo ser erroneo)");
// Para cada imputacion con gap>15, ver si hay otra factura del mismo tipo, |total|±10,
// mismo RUT contraparte, con issueDate mas cercana al mov que la elegida.
function counterRutOfInv(inv: Invoice) { return inv.type === "emitida" ? inv.rutReceiver : inv.rutIssuer; }
const misMatchRisk: { mov: Mov; chosen: Invoice; better: Invoice; chosenGap: number; betterGap: number }[] = [];
for (const g of farGaps) {
  const { mov, inv } = g;
  const rt = tail8(counterRutOfInv(inv));
  const siblings = invoices.filter(o =>
    o.id !== inv.id && o.type === inv.type && (o.tipoDoc ?? 0) !== 61 &&
    Math.abs(o.totalAmount - Math.abs(mov.amount)) <= 10 &&
    (rt ? tail8(counterRutOfInv(o)) === rt : true)
  );
  for (const s of siblings) {
    const sGap = daysBetween(mov.date, s.issueDate);
    if (sGap < g.gap) { misMatchRisk.push({ mov, chosen: inv, better: s, chosenGap: g.gap, betterGap: sGap }); break; }
  }
}
console.log(`Casos con factura alternativa mas cercana en fecha (mismo monto+RUT): ${misMatchRisk.length}`);
for (const r of misMatchRisk.slice(0, 25)) {
  const pr = r.chosen.projectId ? projById.get(r.chosen.projectId)?.name : "—";
  const prB = r.better.projectId ? projById.get(r.better.projectId)?.name : "—";
  console.log(`  Mov ${r.mov.date.slice(0,10)} ${fmt(r.mov.amount)} "${(r.mov.counterpartyName||r.mov.description).slice(0,28)}"`);
  console.log(`     → matcheo F-${r.chosen.folioNumber} (${r.chosen.issueDate.slice(0,10)}, gap ${r.chosenGap.toFixed(0)}d, proy ${pr})`);
  console.log(`     pero existia F-${r.better.folioNumber} (${r.better.issueDate.slice(0,10)}, gap ${r.betterGap.toFixed(0)}d, proy ${prB}) mismo monto/RUT`);
}

sub("1c. Top 15 imputaciones con mayor gap (independiente de siblings)");
for (const g of farGaps.slice(0, 15)) {
  const pr = g.inv.projectId ? projById.get(g.inv.projectId)?.name : "—";
  console.log(`  gap ${g.gap.toFixed(0)}d | mov ${g.mov.date.slice(0,10)} ${fmt(g.mov.amount)} ↔ F-${g.inv.folioNumber} ${g.inv.issueDate.slice(0,10)} ${g.inv.type} (${pr}) ${fmt(g.inv.totalAmount)}`);
}

// ════════════════════════════════════════════════════════════════════
H("FOCO 2 — import:261 'toma el primero' ante ambiguedad");
console.log("Gatilla cuando hay >1 factura candidata por monto y: (a) el mov no tiene");
console.log("counterpartyRut → toma candidates[0]; o (b) >=2 candidatas comparten el RUT.");
console.log("NOTA: no hay log del import; esto RECONSTRUYE la poblacion en riesgo desde el");
console.log("estado actual: movs conciliados (1 imputacion que cubre el total) cuyo monto");
console.log("coincidia con >=2 facturas del lado correspondiente.");

const ambigA: { mov: Mov; chosen: Invoice; cands: Invoice[] }[] = []; // sin counterpartyRut
const ambigB: { mov: Mov; chosen: Invoice; cands: Invoice[] }[] = []; // >=2 mismo RUT
for (const m of movs) {
  if (m.status !== "conciliado") continue;
  const mp = payByMov.get(m.id) ?? [];
  if (mp.length !== 1) continue; // un solo pago
  const inv = invById.get(mp[0].invoiceId);
  if (!inv) continue;
  if (Math.abs(mp[0].amountApplied - Math.abs(m.amount)) > 1) continue; // cubre el total del mov
  const isCargo = m.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";
  const abs = Math.abs(m.amount);
  // Candidatas por monto (aprox: totalAmount±10), del lado correcto, no NC
  const cands = invoices.filter(o => o.type === targetType && (o.tipoDoc ?? 0) !== 61 &&
    Math.abs(o.totalAmount - abs) <= 10);
  if (cands.length < 2) continue;
  if (!digits(m.counterpartyRut)) {
    ambigA.push({ mov: m, chosen: inv, cands });
  } else {
    const rt = tail8(m.counterpartyRut);
    const sameRut = cands.filter(o => tail8(counterRutOfInv(o)) === rt);
    if (sameRut.length >= 2) ambigB.push({ mov: m, chosen: inv, cands: sameRut });
  }
}
console.log(`\n(a) Mov conciliado SIN counterpartyRut con >=2 candidatas por monto: ${ambigA.length}`);
for (const r of ambigA.slice(0, 30)) {
  console.log(`  Mov ${r.mov.date.slice(0,10)} ${fmt(r.mov.amount)} "${(r.mov.description).slice(0,30)}" → F-${r.chosen.folioNumber} ${r.chosen.issueDate.slice(0,10)}`);
  console.log(`     candidatas mismo monto: ${r.cands.map(c => `F-${c.folioNumber}(${c.issueDate.slice(0,10)},${c.businessName?.slice(0,14)})`).join(" | ")}`);
}
console.log(`\n(b) Mov conciliado CON counterpartyRut pero >=2 candidatas del MISMO RUT: ${ambigB.length}`);
for (const r of ambigB.slice(0, 30)) {
  console.log(`  Mov ${r.mov.date.slice(0,10)} ${fmt(r.mov.amount)} "${(r.mov.counterpartyName||r.mov.description).slice(0,26)}" → F-${r.chosen.folioNumber} ${r.chosen.issueDate.slice(0,10)}`);
  console.log(`     candidatas mismo RUT/monto: ${r.cands.map(c => `F-${c.folioNumber}(${c.issueDate.slice(0,10)})`).join(" | ")}`);
}

// ════════════════════════════════════════════════════════════════════
H("A. INTEGRIDAD DE FACTURAS");
sub("A1. Campos criticos nulos");
const nullType = invoices.filter(i => !i.type);
const nullTotal = invoices.filter(i => i.totalAmount == null);
const nullIssue = invoices.filter(i => !i.issueDate);
const nullRutIssuer = invoices.filter(i => !i.rutIssuer);
const nullFolio = invoices.filter(i => !i.folioNumber);
const nullTipoDoc = invoices.filter(i => i.tipoDoc == null);
console.log(`type null: ${nullType.length} | totalAmount null: ${nullTotal.length} | issueDate null: ${nullIssue.length}`);
console.log(`rutIssuer null: ${nullRutIssuer.length} | folioNumber null: ${nullFolio.length} | tipoDoc null: ${nullTipoDoc.length}`);

sub("A2. Facturas RECIBIDAS sin proyecto / sin categoria (huerfanas)");
const recibidas = invoices.filter(i => i.type === "recibida");
const emitidas = invoices.filter(i => i.type === "emitida");
const recSinProy = recibidas.filter(i => !i.projectId);
const recSinCat = recibidas.filter(i => !i.categoryId);
console.log(`Recibidas: ${recibidas.length} | sin proyecto: ${recSinProy.length} | sin categoria: ${recSinCat.length}`);
console.log(`Emitidas: ${emitidas.length} | sin proyecto: ${emitidas.filter(i=>!i.projectId).length} | sin conceptoCobro: ${emitidas.filter(i=>!i.conceptoCobro).length}`);
// Monto en juego de recibidas sin proyecto (excluyendo NC)
const recSinProyMonto = recSinProy.filter(i=>(i.tipoDoc??0)!==61).reduce((s,i)=>s+i.netAmount,0);
console.log(`Monto neto de recibidas sin proyecto (sin NC): ${fmt(recSinProyMonto)}`);

sub("A3. Totales negativos accidentales (no-NC con total < 0)");
const negNoNC = invoices.filter(i => i.totalAmount < 0 && (i.tipoDoc ?? 0) !== 61);
console.log(`Facturas no-NC con totalAmount < 0: ${negNoNC.length}`);
negNoNC.slice(0,10).forEach(i=>console.log(`  F-${i.folioNumber} ${i.type} ${fmt(i.totalAmount)} ${i.businessName}`));

sub("A4. Notas de credito (tipoDoc 61): linkeo");
const ncs = invoices.filter(i => i.tipoDoc === 61);
const ncSinRef = ncs.filter(i => !i.referenceFolioNumber);
console.log(`NCs totales: ${ncs.length} | sin referenceFolioNumber: ${ncSinRef.length}`);
// NCs cuyo referenceFolio no existe como factura en la base (huerfanas de origen)
let ncRefNoExiste = 0;
for (const nc of ncs.filter(n=>n.referenceFolioNumber)) {
  const orig = invoices.find(o => o.folioNumber === nc.referenceFolioNumber &&
    tail8(o.rutIssuer) === tail8(nc.rutIssuer) && o.type === nc.type && (o.tipoDoc??0)!==61);
  if (!orig) ncRefNoExiste++;
}
console.log(`NCs cuya factura referenciada NO esta en la base: ${ncRefNoExiste}`);
console.log(`NCs sin proyecto: ${ncs.filter(i=>!i.projectId).length} | sin categoria: ${ncs.filter(i=>i.type==='recibida'&&!i.categoryId).length}`);

sub("A5. Duplicados sospechosos (mismo folio+RUT en distinto type, o mismo folio+RUT+monto)");
const keyFR = new Map<string, Invoice[]>();
for (const i of invoices) {
  const k = `${digits(i.rutIssuer)}|${i.folioNumber}|${i.tipoDoc}`;
  (keyFR.get(k) ?? keyFR.set(k, []).get(k)!).push(i);
}
const dupFR = [...keyFR.values()].filter(a => a.length > 1);
console.log(`Grupos (rutIssuer+folio+tipoDoc) con >1 factura [distinto type]: ${dupFR.length}`);
dupFR.slice(0,15).forEach(a=>console.log(`  folio ${a[0].folioNumber} rut ${a[0].rutIssuer}: ${a.map(x=>`${x.type}/${fmt(x.totalAmount)}`).join(" , ")}`));

// ════════════════════════════════════════════════════════════════════
H("B. MODELO DE PAGO");
sub("B1. Facturas sobre-pagadas (sum imputado > total + $1)");
const overpaid = invoices.filter(i => sumPayInv(i.id) > i.totalAmount + 1 && (i.tipoDoc??0)!==61);
console.log(`Sobre-pagadas: ${overpaid.length}`);
overpaid.slice(0,20).forEach(i=>console.log(`  F-${i.folioNumber} ${i.type} total ${fmt(i.totalAmount)} imputado ${fmt(sumPayInv(i.id))} (${i.businessName?.slice(0,20)})`));

sub("B2. Status incoherente vs suma imputada");
let statusWrongPagada = 0, statusWrongNoPagada = 0;
const wrongList: string[] = [];
for (const i of invoices) {
  if (i.status === "anulada" || (i.tipoDoc??0)===61) continue;
  const s = sumPayInv(i.id);
  const should = s >= i.totalAmount - 1 ? "pagada" : s > 0 ? "parcial" : "pendiente";
  if (should === "pagada" && i.status !== "pagada") { statusWrongNoPagada++; if(wrongList.length<20) wrongList.push(`F-${i.folioNumber} ${i.type} status=${i.status} pero imputado ${fmt(s)}>=total ${fmt(i.totalAmount)}`); }
  if (should !== "pagada" && i.status === "pagada" && i.origin!=="sin_respaldo") { statusWrongPagada++; if(wrongList.length<20) wrongList.push(`F-${i.folioNumber} ${i.type} status=pagada pero imputado ${fmt(s)}<total ${fmt(i.totalAmount)} (origin ${i.origin})`); }
}
console.log(`Deberia ser pagada y no lo esta: ${statusWrongNoPagada}`);
console.log(`Esta pagada pero imputado < total (y no es sin_respaldo): ${statusWrongPagada}`);
wrongList.forEach(w=>console.log("  "+w));

sub("B3. Movimientos sobre-imputados (sum imputado > |amount| + $1) [imposible]");
const movOver = movs.filter(m => sumPayMov(m.id) > Math.abs(m.amount) + 1);
console.log(`Movimientos con imputaciones > su monto: ${movOver.length}`);
movOver.slice(0,15).forEach(m=>console.log(`  Mov ${m.date.slice(0,10)} ${fmt(m.amount)} imputado ${fmt(sumPayMov(m.id))}`));

// ════════════════════════════════════════════════════════════════════
H("C. CONCILIACION BANCARIA");
sub("C1. Cobertura por mes (movimientos no-internos)");
const noInternal = movs.filter(m => m.status !== "interno");
const monthAgg = new Map<string, { total: number; conc: number; sinAsig: number; sinFact: number; parc: number }>();
for (const m of noInternal) {
  const k = ym(m.date);
  const a = monthAgg.get(k) ?? { total:0, conc:0, sinAsig:0, sinFact:0, parc:0 };
  a.total++;
  if (m.status === "conciliado") a.conc++;
  else if (m.status === "sin_asignar") a.sinAsig++;
  else if (m.status === "sin_factura") a.sinFact++;
  else if (m.status === "parcial") a.parc++;
  monthAgg.set(k, a);
}
[...monthAgg.keys()].sort().forEach(k=>{
  const a = monthAgg.get(k)!;
  const cov = ((a.conc + a.sinFact) / a.total * 100).toFixed(0);
  console.log(`  ${k}: total ${String(a.total).padStart(4)} | conc ${String(a.conc).padStart(4)} sinAsig ${String(a.sinAsig).padStart(4)} sinFact ${String(a.sinFact).padStart(3)} parc ${a.parc} | resuelto ${cov}%`);
});

sub("C2. Antiguedad de movimientos sin_asignar (vs hoy)");
const today = new Date(db.meta.generatedAt);
const sinAsig = noInternal.filter(m => m.status === "sin_asignar");
const ageB = { "<=30":0, "31-60":0, "61-90":0, ">90":0 };
for (const m of sinAsig) {
  const d = (today.getTime() - new Date(m.date).getTime())/86400000;
  if (d<=30) ageB["<=30"]++; else if (d<=60) ageB["31-60"]++; else if (d<=90) ageB["61-90"]++; else ageB[">90"]++;
}
const sinAsigMontoAbon = sinAsig.filter(m=>m.amount>0).reduce((s,m)=>s+m.amount,0);
const sinAsigMontoCargo = sinAsig.filter(m=>m.amount<0).reduce((s,m)=>s+m.amount,0);
console.log(`sin_asignar: ${sinAsig.length} | antiguedad`, ageB);
console.log(`  monto abonos sin asignar: ${fmt(sinAsigMontoAbon)} | cargos sin asignar: ${fmt(sinAsigMontoCargo)}`);

sub("C3. sin_asignar por contraparte (top 20)");
const byParty = new Map<string, { n:number; monto:number }>();
for (const m of sinAsig) {
  const k = (m.counterpartyName || m.description.slice(0,30)).trim();
  const a = byParty.get(k) ?? {n:0,monto:0}; a.n++; a.monto+=m.amount; byParty.set(k,a);
}
[...byParty.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,20).forEach(([k,v])=>console.log(`  ${String(v.n).padStart(3)}x ${fmt(v.monto).padStart(14)} ${k}`));

sub("C4. Doble conciliacion / split: movimientos imputados a >1 factura");
const multiInv = [...payByMov.entries()].filter(([,ps]) => new Set(ps.map(p=>p.invoiceId)).size > 1);
console.log(`Movimientos imputados a >1 factura (splits): ${multiInv.length}`);
sub("C4b. Splits CRUZADOS entre proyectos distintos");
let crossProj = 0;
for (const [movId, ps] of multiInv) {
  const projs = new Set(ps.map(p => invById.get(p.invoiceId)?.projectId).filter(Boolean));
  if (projs.size > 1) {
    crossProj++;
    const m = movById.get(movId)!;
    console.log(`  Mov ${m.date.slice(0,10)} ${fmt(m.amount)} → ${ps.map(p=>{const i=invById.get(p.invoiceId)!;return `F-${i.folioNumber}/${projById.get(i.projectId||'')?.name||'—'}`;}).join(" + ")}`);
  }
}
console.log(`Total splits cruzados entre proyectos: ${crossProj}`);

sub("C5. Conciliacion cruzada: mov imputado a factura, donde la categoria del mov sugeria otra cosa (info)");
console.log("(BankMovement no tiene projectId; la asignacion de proyecto vive en la factura)");

// ════════════════════════════════════════════════════════════════════
H("D. PAGOS SIN RESPALDO (tipoDoc 1043 / origin sin_respaldo)");
const sr = invoices.filter(i => i.origin === "sin_respaldo" || i.tipoDoc === 1043);
console.log(`Total pagos sin respaldo: ${sr.length}`);
console.log(`  sin proyecto: ${sr.filter(i=>!i.projectId).length} | sin categoria: ${sr.filter(i=>!i.categoryId).length}`);
console.log(`  monto total: ${fmt(sr.reduce((s,i)=>s+i.totalAmount,0))}`);
const srSinPay = sr.filter(i => (payByInvoice.get(i.id)?.length ?? 0) === 0);
console.log(`  sin imputacion bancaria (huerfanos, deberian no existir): ${srSinPay.length}`);

// ════════════════════════════════════════════════════════════════════
H("E. REEMBOLSADORES");
for (const r of reembs) {
  console.log(`  ${r.nombre} | glosa "${r.glosa}" | personRut ${r.personRut||'—'} | aliases: ${r.aliases.map(a=>`${a.businessName||'?'}(${a.rut})`).join(", ")||'(ninguno)'}`);
}
sub("E2. Riesgo de doble conteo: pago sin respaldo a una persona-reembolsador (mismo personRut) cargado a proyecto");
const reembPersonRuts = reembs.map(r=>tail8(r.personRut)).filter(Boolean);
const srToReemb = sr.filter(i => reembPersonRuts.includes(tail8(i.rutIssuer)));
console.log(`Pagos sin respaldo cuyo RUT contraparte = personRut de un reembolsador: ${srToReemb.length}`);
console.log("  (Si ese pago ya esta cubierto por una factura del alias cargada al mismo proyecto, es doble conteo)");
srToReemb.slice(0,20).forEach(i=>console.log(`  ${i.issueDate.slice(0,10)} ${fmt(i.totalAmount)} ${i.businessName} proy ${projById.get(i.projectId||'')?.name||'—'}`));

// ════════════════════════════════════════════════════════════════════
H("F. INGRESO DE DATOS BANCARIOS");
sub("F1. balanceAfter null (sin cartola de respaldo / riesgo dedup)");
console.log(`Movimientos con balanceAfter null: ${movs.filter(m=>m.balanceAfter==null).length}`);
sub("F2. Variantes de nombre de contraparte (misma entidad, distinta escritura)");
// Normalizar: upper, sin tildes, sin puntuacion, colapsar espacios; agrupar por RUT.
const norm = (s:string|null)=> (s??"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
const byRutNames = new Map<string, Set<string>>();
for (const m of movs) {
  const rt = tail8(m.counterpartyRut);
  if (!rt || !m.counterpartyName) continue;
  (byRutNames.get(rt) ?? byRutNames.set(rt, new Set()).get(rt)!).add(norm(m.counterpartyName));
}
const variantes = [...byRutNames.entries()].filter(([,n])=>n.size>1);
console.log(`RUTs de contraparte con >1 variante de nombre: ${variantes.length}`);
variantes.slice(0,20).forEach(([rt,n])=>console.log(`  ...${rt}: ${[...n].join(" | ")}`));

sub("F3. Meses sin ningun movimiento (gaps de cartola) — operativa+sueldos juntos");
const allMonths = [...new Set(movs.map(m=>ym(m.date)))].sort();
console.log(`Rango: ${allMonths[0]} .. ${allMonths[allMonths.length-1]} | meses con datos: ${allMonths.length}`);
console.log(`Meses presentes: ${allMonths.join(", ")}`);

// ════════════════════════════════════════════════════════════════════
H("G. ASIGNACION A PROYECTO (glosa con proyecto explicito)");
const projWords = projects.filter(p=>!p.isInternal).map(p=>({p, w: norm(p.name).split(" ").filter(x=>x.length>=4)}));
let glosaProjHits = 0;
const glosaSamples: string[] = [];
for (const m of noInternal) {
  const dn = norm(m.description + " " + (m.counterpartyName||""));
  for (const {p,w} of projWords) {
    if (w.some(word => dn.includes(word))) {
      glosaProjHits++;
      const assignedVia = (payByMov.get(m.id)||[]).map(pp=>invById.get(pp.invoiceId)?.projectId).filter(Boolean);
      const ok = assignedVia.includes(p.id);
      if (glosaSamples.length<25) glosaSamples.push(`${m.date.slice(0,10)} ${fmt(m.amount)} "${(m.description+' '+(m.counterpartyName||'')).slice(0,40)}" ~ proyecto "${p.name}" | imputado a ese proy: ${ok?'si':'NO/sin imputar'}`);
      break;
    }
  }
}
console.log(`Movimientos cuya glosa menciona el nombre de un proyecto: ${glosaProjHits}`);
glosaSamples.forEach(s=>console.log("  "+s));

// ════════════════════════════════════════════════════════════════════
H("H. PATRONES");
sub("H1. N transferencias mismo dia + misma persona que SUMAN una factura");
// Agrupar movs cargo por (dia, tail8 rut), sumar, buscar factura recibida con ese total.
const grp = new Map<string, Mov[]>();
for (const m of movs) {
  if (m.amount >= 0 || m.status==="interno") continue;
  const rt = tail8(m.counterpartyRut); if (!rt) continue;
  const k = `${m.date.slice(0,10)}|${rt}`;
  (grp.get(k) ?? grp.set(k,[]).get(k)!).push(m);
}
let h1 = 0; const h1s:string[]=[];
for (const [k, ms] of grp) {
  if (ms.length < 2) continue;
  const suma = Math.abs(ms.reduce((s,m)=>s+m.amount,0));
  // factura recibida (cualquier RUT — reembolso) con ese total ±50
  const f = invoices.find(i=>i.type==="recibida"&&(i.tipoDoc??0)!==61&&Math.abs(i.totalAmount-suma)<=50);
  if (f) { h1++; if(h1s.length<20) h1s.push(`${k.slice(0,10)} ${ms.length} transf = ${fmt(suma)} ~ F-${f.folioNumber} ${f.businessName?.slice(0,18)} ${fmt(f.totalAmount)}`); }
}
console.log(`Dias con N transferencias a la misma persona que suman ~una factura: ${h1}`);
h1s.forEach(s=>console.log("  "+s));

sub("H3. Facturas pagadas con N imputaciones en fechas distintas (cobro/pago parcial real)");
let h3 = 0;
for (const [invId, ps] of payByInvoice) {
  const dates = new Set(ps.map(p=>movById.get(p.bankMovementId)?.date.slice(0,10)).filter(Boolean));
  if (ps.length>=2 && dates.size>=2) h3++;
}
console.log(`Facturas con >=2 imputaciones en fechas distintas: ${h3}`);

sub("H4. Facturas con NC posterior que tuvieron pagos parciales antes");
let h4=0; const h4s:string[]=[];
for (const nc of ncs.filter(n=>n.referenceFolioNumber)) {
  const orig = invoices.find(o=>o.folioNumber===nc.referenceFolioNumber && tail8(o.rutIssuer)===tail8(nc.rutIssuer) && o.type===nc.type);
  if (!orig) continue;
  const ps = payByInvoice.get(orig.id) ?? [];
  if (ps.length>0) { h4++; if(h4s.length<15) h4s.push(`NC F-${nc.folioNumber} sobre F-${orig.folioNumber} (${orig.businessName?.slice(0,16)}) que tenia ${ps.length} pago(s) ${fmt(sumPayInv(orig.id))}`); }
}
console.log(`Facturas con pagos previos y NC posterior: ${h4}`);
h4s.forEach(s=>console.log("  "+s));

sub("H5. Misma persona recibiendo reembolso (conciliado a factura) Y servicio directo (sin_respaldo)");
const personConcil = new Set<string>();
const personSR = new Set<string>();
for (const m of movs) {
  const rt = tail8(m.counterpartyRut); if(!rt) continue;
  if (m.status==="conciliado") {
    const ps = payByMov.get(m.id)||[];
    if (ps.some(p=>{const i=invById.get(p.invoiceId);return i&&i.origin!=="sin_respaldo";})) personConcil.add(rt);
    if (ps.some(p=>{const i=invById.get(p.invoiceId);return i&&i.origin==="sin_respaldo";})) personSR.add(rt);
  }
}
const both = [...personConcil].filter(rt=>personSR.has(rt));
console.log(`Personas con AMBOS conceptos (reembolso c/factura + servicio directo sin respaldo): ${both.length}`);
both.slice(0,20).forEach(rt=>{
  const nm = movs.find(m=>tail8(m.counterpartyRut)===rt)?.counterpartyName;
  console.log(`  ...${rt} ${nm}`);
});

sub("H9. Movimientos que NO son transferencias a personas (sin counterpartyRut) — como se tratan");
const noRut = noInternal.filter(m=>!digits(m.counterpartyRut));
const noRutByStatus: Record<string,number> = {};
for (const m of noRut) noRutByStatus[m.status]=(noRutByStatus[m.status]??0)+1;
console.log(`Movs sin counterpartyRut (compras tarjeta, comisiones, depositos, etc): ${noRut.length}`, noRutByStatus);

sub("H-internas. Transferencias internas detectadas");
console.log(`Movs status=interno: ${movs.filter(m=>m.status==="interno").length}`);

// ════════════════════════════════════════════════════════════════════
H("I. COHERENCIA DE TOTALES (suma cruda)");
const sign = (i:Invoice)=> (i.tipoDoc===61?-1:1);
const cobrado = emitidas.reduce((s,i)=>s+sign(i)*i.totalAmount,0);
const gastado = recibidas.reduce((s,i)=>s+sign(i)*i.netAmount,0);
console.log(`Cobrado (emitidas c/IVA, NC resta): ${fmt(cobrado)}`);
console.log(`Gastado (recibidas neto, NC resta, incl sin_respaldo): ${fmt(gastado)}`);
console.log(`  de eso, sin_respaldo: ${fmt(sr.reduce((s,i)=>s+i.netAmount,0))}`);

console.log("\n\n=== FIN ===");
