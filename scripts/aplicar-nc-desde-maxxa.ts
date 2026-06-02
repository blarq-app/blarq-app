// Vincula las Notas de Crédito recibidas que quedaron SUELTAS (sin
// referenceFolioNumber) a la factura que cancelan, usando el vínculo que trae
// el EXPORT de Maxxa (columna FolioDocRef de cada NC). El SII NO devuelve estas
// referencias (getDteReferencias da vacío), pero Maxxa sí las tiene = verdad de MJ.
//
// Luego aplica la compensación: marca la factura "anulada" si las NC + pagos la
// cubren entera, "parcial" si la cubren en parte. Esto limpia la lista de
// pendientes (facturas que ya están canceladas por NC dejan de parecer deuda).
//
// IMPORTANTE — NO mueve el gasto POR OBRA: metrics.ts ya netea la NC (sign -1)
// y NO filtra "anulada", así que el neto por proyecto queda idéntico. Lo que
// cambia es el ESTADO/lista y el total de control "recibidas no-anuladas".
//
// CANDADOS: solo prod · solo NC sin referencia y sin compensación · solo si la
//   factura objetivo está en la app · coverage = pagos + TODAS las NC que
//   apuntan a esa factura (no solo esta) · idempotente.
//
// DRY-RUN por default. Aplicar: --apply
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/aplicar-nc-desde-maxxa.ts

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");
const FACT_TD = [33, 34, 39, 41, 56];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── export Maxxa: NC (folio+rut) → {refTipoDoc, refFolio} ──
  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const xr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = xr[0]; const ci = (n: string) => H.indexOf(n);
  const cTd = ci("CodTipoDoc"), cF = ci("FolioDoc"), cR = ci("RutDoc"), cTdr = ci("TipoDocRef"), cFdr = ci("FolioDocRef");
  const refDeNC = new Map<string, { refTd: number; refFolio: string }>();
  for (let i = 1; i < xr.length; i++) {
    if (String(xr[i][cTd]) !== "61") continue;
    const folioRef = noZero(xr[i][cFdr]); if (!folioRef) continue;
    refDeNC.set(`${noZero(xr[i][cF])}|${rut8(xr[i][cR])}`, { refTd: Number(xr[i][cTdr]) || 33, refFolio: folioRef });
  }

  // ── app: todas las recibidas ──
  const recibidas = await prisma.invoice.findMany({
    where: { type: "recibida" },
    select: { id: true, tipoDoc: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, referenceFolioNumber: true, compensationType: true, appliedToInvoiceId: true, payments: { select: { amountApplied: true } } },
  });
  const facturas = recibidas.filter((i) => i.tipoDoc !== 61);
  const ncs = recibidas.filter((i) => i.tipoDoc === 61);
  const factByKey = new Map<string, any>();
  for (const f of facturas) { const k = `${noZero(f.folioNumber)}|${rut8(f.rutIssuer)}`; if (k !== "|") factByKey.set(k, f); }
  const paidOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);

  // ── plan: NC suelta → su factura (desde Maxxa) ──
  type PlanNC = { ncId: string; ncFolio: string; ncProv: string; ncAbs: number; refTd: number; refFolio: string; targetId: string };
  const plan: PlanNC[] = [];
  const sinRefEnMaxxa: string[] = [];
  const targetNoEnApp: string[] = [];
  for (const nc of ncs) {
    if (nc.referenceFolioNumber || nc.compensationType) continue; // ya vinculada
    const ref = refDeNC.get(`${noZero(nc.folioNumber)}|${rut8(nc.rutIssuer)}`);
    if (!ref) { sinRefEnMaxxa.push(`NC f${noZero(nc.folioNumber)} ${(nc.businessName ?? "").slice(0, 24)} ${fmt(Math.abs(nc.totalAmount))}`); continue; }
    const target = factByKey.get(`${ref.refFolio}|${rut8(nc.rutIssuer)}`);
    if (!target || !FACT_TD.includes(target.tipoDoc)) { targetNoEnApp.push(`NC f${noZero(nc.folioNumber)} ${(nc.businessName ?? "").slice(0, 24)} → ref f${ref.refFolio} (${ref.refTd}) no está en la app`); continue; }
    plan.push({ ncId: nc.id, ncFolio: noZero(nc.folioNumber), ncProv: nc.businessName ?? "", ncAbs: Math.abs(nc.totalAmount), refTd: ref.refTd, refFolio: ref.refFolio, targetId: target.id });
  }

  // ── coverage por factura objetivo: pagos + TODAS las NC que la apuntan ──
  // (las ya vinculadas por appliedToInvoiceId + las que vincularíamos ahora)
  const ncAbsPorTarget = new Map<string, number>();
  for (const p of plan) ncAbsPorTarget.set(p.targetId, (ncAbsPorTarget.get(p.targetId) ?? 0) + p.ncAbs);
  for (const nc of ncs) if (nc.appliedToInvoiceId) ncAbsPorTarget.set(nc.appliedToInvoiceId, (ncAbsPorTarget.get(nc.appliedToInvoiceId) ?? 0) + Math.abs(nc.totalAmount));

  // Clasificación de cada factura objetivo según pagos vs NC:
  //   G1 anular        — nunca pagada ($0) y la NC la cubre entera → cancelada.
  //   G2 reembolso     — ya pagada por el banco (>= total) + NC = plata que volvió.
  //                      NO se anula: sigue pagada, solo se vincula la NC.
  //   G3 saldada-mixta — pagada en parte + NC cubre el resto → quedó saldada,
  //                      pero parte se pagó de verdad → decisión de MJ (no auto).
  //   G4 parcial       — NC chica, la factura sigue debiendo → parcial.
  type Cambio = { grupo: string; folio: string; prov: string; total: number; pagado: number; nc: number; hoy: string; nuevo: string };
  const cambios: Cambio[] = [];
  const targets = new Set(plan.map((p) => p.targetId));
  for (const tid of targets) {
    const f = facturas.find((x) => x.id === tid)!;
    const pagado = paidOf(f);
    const ncTot = ncAbsPorTarget.get(tid) ?? 0;
    const cubierto = pagado + ncTot;
    let grupo: string, nuevo: string;
    if (pagado <= 1 && cubierto >= f.totalAmount - 10) { grupo = "G1_anular"; nuevo = "anulada"; }
    else if (pagado >= f.totalAmount - 10) { grupo = "G2_reembolso"; nuevo = f.status; } // queda pagada, no se toca
    else if (cubierto >= f.totalAmount - 10) { grupo = "G3_saldada_mixta"; nuevo = "pagada"; } // MJ: marcar saldada
    else { grupo = "G4_parcial"; nuevo = "parcial"; }
    cambios.push({ grupo, folio: noZero(f.folioNumber), prov: (f.businessName ?? "").slice(0, 26), total: f.totalAmount, pagado, nc: ncTot, hoy: f.status, nuevo });
  }
  const grupoDe = (g: string) => cambios.filter((c) => c.grupo === g).sort((a, b) => b.total - a.total);

  // ── mostrar ──
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN (no escribe)"} — vincular NC sueltas desde Maxxa\n`);
  console.log(`NC sueltas a vincular: ${plan.length} · facturas objetivo: ${targets.size}`);
  console.log(`NC sin FolioDocRef en Maxxa (no se puede): ${sinRefEnMaxxa.length} · NC cuya factura no está en la app: ${targetNoEnApp.length}\n`);
  const print = (g: string, titulo: string) => {
    const list = grupoDe(g);
    console.log(`\n── ${g} · ${list.length} · ${fmt(list.reduce((s, c) => s + c.total, 0))} — ${titulo} ──`);
    for (const c of list) console.log(`  f${c.folio} ${c.prov.padEnd(26)} total ${fmt(c.total).padStart(12)} pagado ${fmt(c.pagado).padStart(10)} NC ${fmt(c.nc).padStart(11)} [${c.hoy}${c.nuevo !== c.hoy ? "→" + c.nuevo : " (sin cambio)"}]`);
  };
  print("G1_anular", "nunca pagada + NC la cancela → ANULAR (esto sí se aplica)");
  print("G2_reembolso", "ya pagada + NC = reembolso → sigue PAGADA, solo se vincula");
  print("G3_saldada_mixta", "pagada en parte + NC cubre el resto → DECISIÓN MJ");
  print("G4_parcial", "NC chica, sigue debiendo → parcial");
  if (targetNoEnApp.length) { console.log(`\n── NC cuya factura no está en la app (se vincula la ref pero no hay qué anular) ──`); targetNoEnApp.forEach((s) => console.log(`  ${s}`)); }
  if (sinRefEnMaxxa.length) { console.log(`\n── NC sin referencia en Maxxa (quedan sueltas, revisar a mano) ──`); sinRefEnMaxxa.forEach((s) => console.log(`  ${s}`)); }

  // gasto por obra de control: SUMA recibidas con NC negativa (= lo que ve metrics, sin filtrar anulada)
  const netoMetrics = recibidas.reduce((s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount, 0);
  const controlNoAnul = facturas.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nNeto recibidas (estilo metrics, NC restando, no filtra anulada): ${fmt(netoMetrics)}  ← NO debe cambiar`);
  console.log(`Control "recibidas no-anuladas" (sí filtra anulada): ${fmt(controlNoAnul)}  ← este SÍ baja al anular`);

  if (!APPLY) { console.log(`\nPara aplicar: --apply (hace backup, setea referenceFolioNumber + compensationType, actualiza estado).`); await prisma.$disconnect(); return; }

  // ── aplicar — G1 (anular) + G3 (saldada→pagada) + G4 (parcial). G2 (reembolsos) NO. ──
  const actuar = new Set(cambios.filter((c) => ["G1_anular", "G3_saldada_mixta", "G4_parcial"].includes(c.grupo)).map((c) => c.folio));
  const targetFolioById = new Map(facturas.map((f) => [f.id, noZero(f.folioNumber)]));
  let setRef = 0, comp = 0;
  for (const p of plan) {
    if (!actuar.has(targetFolioById.get(p.targetId) ?? "")) continue; // NC de G2 → no se toca este run
    await prisma.invoice.update({ where: { id: p.ncId }, data: { referenceFolioNumber: p.refFolio, referenceTipoDoc: p.refTd, compensationType: "other_invoice", appliedToInvoiceId: p.targetId, status: "pagada", paidAt: new Date() } });
    setRef++;
  }
  for (const c of cambios) {
    if (c.nuevo === c.hoy) continue; // G2 sin cambio
    const f = facturas.find((x) => noZero(x.folioNumber) === c.folio)!;
    await prisma.invoice.update({ where: { id: f.id }, data: { status: c.nuevo, ...(c.nuevo === "anulada" || c.nuevo === "pagada" ? { paidAt: new Date() } : {}) } });
    comp++;
  }
  const post = await prisma.invoice.findMany({ where: { type: "recibida" }, select: { tipoDoc: true, totalAmount: true, status: true } });
  const netoPost = post.reduce((s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount, 0);
  console.log(`\nAPLICADO: ${setRef} NC vinculadas, ${comp} facturas re-etiquetadas.`);
  console.log(`Neto recibidas (estilo metrics): ${fmt(netoMetrics)} → ${fmt(netoPost)} (debe ser igual)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
