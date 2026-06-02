// READ-ONLY — auditoría de Notas de Crédito recibidas vs el estado de su factura.
//
// Pregunta de MJ: ¿están TODAS las NC anulando (o dejando parcial) la factura
// que referencian? Una NC que cubre entera su factura debería dejarla "anulada";
// si la cubre en parte, "parcial". Si la factura sigue "pendiente"/"parcial" sin
// reflejar la NC, es un bug de etiqueta (la factura parece deuda pero ya está
// cancelada). Esto NO mueve el gasto por obra (metrics netea la NC), es estado.
//
// Replica la lógica de autoApplyNcCompensation (linkNcReferences.ts) sin escribir.
// NO toca la BD. Uso:
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/auditar-nc-facturas.ts

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");
const FACT_TD = [33, 34, 39, 41, 56];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  const recibidas = await prisma.invoice.findMany({
    where: { type: "recibida" },
    select: { id: true, tipoDoc: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, projectId: true, referenceFolioNumber: true, compensationType: true, appliedToInvoiceId: true, payments: { select: { amountApplied: true } } },
  });
  const ncs = recibidas.filter((i) => i.tipoDoc === 61);
  const facturas = recibidas.filter((i) => i.tipoDoc !== 61);
  const byId = new Map(recibidas.map((i) => [i.id, i]));
  const factByKey = new Map<string, any>();
  for (const f of facturas) { const k = `${noZero(f.folioNumber)}|${rut8(f.rutIssuer)}`; if (k !== "|") factByKey.set(k, f); }
  const paidOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);

  // resolver el target de cada NC y agrupar NCs por factura
  const ncSinRef: any[] = [];
  const ncTargetNoEnApp: any[] = [];
  const ncPorFactura = new Map<string, any[]>(); // factId → ncs
  for (const nc of ncs) {
    let target = nc.appliedToInvoiceId ? byId.get(nc.appliedToInvoiceId) : null;
    if (!target) {
      if (!nc.referenceFolioNumber) { ncSinRef.push(nc); continue; }
      target = factByKey.get(`${noZero(nc.referenceFolioNumber)}|${rut8(nc.rutIssuer)}`);
      if (!target) { ncTargetNoEnApp.push(nc); continue; }
    }
    if (!ncPorFactura.has(target.id)) ncPorFactura.set(target.id, []);
    ncPorFactura.get(target.id)!.push(nc);
  }

  // por cada factura con NC, ver si su estado refleja la cobertura
  type Bad = { folio: string; prov: string; total: number; pagado: number; nc: number; estado: string; deberia: string; ncFolios: string };
  const malEtiquetada: Bad[] = [];
  let okAnulada = 0, okParcial = 0;
  for (const [factId, ncList] of ncPorFactura) {
    const f = byId.get(factId)!;
    const pagado = paidOf(f);
    const ncTot = ncList.reduce((s, n) => s + Math.abs(n.totalAmount), 0);
    const cubierto = pagado + ncTot;
    const deberia = cubierto >= f.totalAmount - 10 ? "anulada" : (cubierto > 0 ? "parcial" : "pendiente");
    const refleja = (deberia === "anulada" && (f.status === "anulada" || f.status === "pagada")) || (deberia === "parcial" && (f.status === "parcial" || f.status === "pagada" || f.status === "anulada"));
    if (refleja) { if (deberia === "anulada") okAnulada++; else okParcial++; continue; }
    malEtiquetada.push({ folio: noZero(f.folioNumber), prov: (f.businessName ?? "").slice(0, 26), total: f.totalAmount, pagado, nc: ncTot, estado: f.status, deberia, ncFolios: ncList.map((n) => `NC${noZero(n.folioNumber)}`).join(",") });
  }

  console.log(`Recibidas: ${recibidas.length} · facturas ${facturas.length} · NCs ${ncs.length}\n`);
  console.log(`NCs vinculadas a una factura de la app: ${[...ncPorFactura.values()].reduce((s, l) => s + l.length, 0)}`);
  console.log(`  → su factura YA refleja la NC: ${okAnulada} anuladas + ${okParcial} parciales`);
  console.log(`  → su factura NO refleja la NC (bug de etiqueta): ${malEtiquetada.length}`);
  console.log(`NCs SIN referenceFolioNumber (no se pueden vincular sin consultar SII): ${ncSinRef.length}`);
  console.log(`NCs con referencia pero su factura NO está en la app: ${ncTargetNoEnApp.length}`);

  const totMal = malEtiquetada.reduce((s, b) => s + b.total, 0);
  console.log(`\n── ${malEtiquetada.length} facturas con NC que NO refleja su estado (debería anularse/parcializar) · ${fmt(totMal)} ──\n`);
  for (const b of malEtiquetada.sort((a, c) => c.total - a.total))
    console.log(`  f${b.folio} ${b.prov.padEnd(26)} total ${fmt(b.total).padStart(12)} pagado ${fmt(b.pagado).padStart(10)} NC ${fmt(b.nc).padStart(11)} → hoy [${b.estado}] debería [${b.deberia}] (${b.ncFolios})`);

  if (ncSinRef.length) {
    console.log(`\n── ${ncSinRef.length} NCs sin referencia (necesitan backfill SII para saber qué factura cancelan) ──`);
    for (const n of ncSinRef.slice(0, 30)) console.log(`  NC f${noZero(n.folioNumber)} ${(n.businessName ?? "").slice(0, 26).padEnd(26)} ${fmt(Math.abs(n.totalAmount)).padStart(11)} [${n.status}]`);
    if (ncSinRef.length > 30) console.log(`  … y ${ncSinRef.length - 30} más`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
