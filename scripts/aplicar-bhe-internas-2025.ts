// Importa las boletas de honorarios (tipoDoc 1039) internas de BLARQ de 2025
// que calzan EXACTO con su transferencia bancaria. Por decisión de MJ, solo
// F-843 (Christian $30.000) y F-589 (Denise $100.000). Crea Invoice recibida
// 1039 (origin maxxa_sin_respaldo, IVA 0, bruto = costo) + InvoicePayment
// contra el movimiento real + concilia. Dry-run por default; --apply escribe.
//
// Nota: estas se pagaron al BRUTO (no se retuvo), por eso el banco muestra el
// bruto. El costo BLARQ es el bruto. No se modela retención (volumen mínimo).
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const EXPORT = "/Users/mjblanco/Downloads/2025_Maxxa/exportar (2).xls";
const BLARQ_RUT = "77270733-9";
const FOLIOS = ["843", "589"]; // las 2 internas limpias
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));
const normRut = (r: string) => String(r || "").replace(/[.\s]/g, "").toUpperCase();
const bodyOf = (r: string) => normRut(r).replace(/-/g, "").replace(/[0-9kK]$/, "");
const f = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const ymd = (d: any) => new Date(d).toISOString().slice(0, 10);
const days = (a: any, b: any) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

function loadBHE() {
  const $ = cheerio.load(readFileSync(EXPORT, "utf-8"));
  const rows = $("table tr");
  const H = rows.first().find("td").map((_, td) => $(td).text().trim()).get();
  const gi = (n: string) => H.indexOf(n);
  const out: any[] = [];
  rows.slice(1).each((_, tr) => {
    const t = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    if (t.length < 10) return;
    if (Number(t[gi("CodTipoDoc")]) !== 1039) return;
    const folio = String(t[gi("FolioDoc")]).trim();
    if (!FOLIOS.includes(folio)) return;
    out.push({ folio, rut: t[gi("RutDoc")], nom: t[gi("NomAux")], fecha: t[gi("FechaDoc")], bruto: num(t[gi("MontoTotal")]) });
  });
  return out;
}

async function main() {
  const isProd = /ep-shy-morning/.test(process.env.DATABASE_URL ?? "");
  console.log(`Entorno: ${isProd ? "PROD" : "?"} | modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const recs = loadBHE();
  const blarq = await prisma.project.findFirst({ where: { isInternal: true }, select: { id: true, name: true } });
  if (!blarq) { console.log("No encontré el proyecto interno BLARQ (isInternal)."); await prisma.$disconnect(); return; }
  const cats = await prisma.costCategory.findMany({ select: { id: true, name: true, parentId: true } });
  const gg = cats.find((c) => c.name.toLowerCase() === "gastos generales");
  console.log(`Proyecto interno: ${blarq.name} | categoría: ${gg?.name ?? "(no encontrada)"}\n`);

  const movs = await prisma.bankMovement.findMany({ where: { amount: { lt: 0 }, date: { gte: new Date("2025-01-01"), lte: new Date("2026-01-31") } }, select: { id: true, date: true, amount: true, counterpartyRut: true, counterpartyName: true, externalRef: true, payments: { select: { id: true } } } });

  const plan: any[] = [];
  for (const r of recs) {
    // ¿ya existe?
    const exists = await prisma.invoice.count({ where: { tipoDoc: 1039, folioNumber: r.folio, rutIssuer: normRut(r.rut) } });
    if (exists) { console.log(`  [YA EXISTE] F-${r.folio}`); continue; }
    const bdy = bodyOf(r.rut);
    const m = movs.find((x) => Math.abs(Math.round(x.amount)) === Math.round(r.bruto) && bdy && normRut(x.counterpartyRut || "").replace(/-/g, "").includes(bdy) && days(x.date, r.fecha) <= 5 && x.payments.length === 0);
    if (!m) { console.log(`  [SIN MOV] F-${r.folio} ${f(r.bruto)} — no hay transferencia libre que calce`); continue; }
    plan.push({ ...r, movId: m.id, movRef: m.externalRef || m.id, movFecha: m.date, movNom: m.counterpartyName });
  }

  console.log("\nA crear:");
  plan.forEach((p) => console.log(`  F-${p.folio}  ${f(p.bruto)}  ${p.fecha}  ${p.nom}  → mov ${ymd(p.movFecha)} "${p.movNom}" ref ${p.movRef}`));
  const sum = plan.reduce((s, p) => s + p.bruto, 0);
  console.log(`\nTotal: ${plan.length} boletas · ${f(sum)} → proyecto interno BLARQ`);

  if (!APPLY) { console.log("\n(DRY-RUN — nada escrito. --apply para aplicar)"); await prisma.$disconnect(); return; }
  if (!gg) { console.log("\nFalta la categoría Gastos generales — no aplico."); await prisma.$disconnect(); process.exit(1); }

  console.log("\nAPLICANDO (secuencial)...");
  let done = 0;
  for (const p of plan) {
    const dup = await prisma.invoicePayment.count({ where: { bankMovementId: p.movId } });
    if (dup > 0) { console.log(`  (ya hecho) F-${p.folio}`); continue; }
    const inv = await prisma.invoice.create({
      data: {
        projectId: blarq.id, categoryId: gg.id, type: "recibida", tipoDoc: 1039,
        folioNumber: p.folio, rutIssuer: normRut(p.rut), rutReceiver: BLARQ_RUT, businessName: p.nom,
        issueDate: new Date(p.fecha), dueDate: new Date(p.fecha), netAmount: p.bruto, iva: 0, totalAmount: p.bruto,
        status: "pagada", paidAt: new Date(p.fecha), origin: "maxxa_sin_respaldo",
        notes: `Boleta de honorarios electrónica recibida (folio ${p.folio}). Migrada de Maxxa 2025. Pagada al bruto, conciliada contra la transferencia real.`,
      },
    });
    await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: inv.id, amountApplied: p.bruto, autoMatched: false } });
    await prisma.bankMovement.update({ where: { id: p.movId }, data: { status: "conciliado", category: null } });
    done++;
  }
  console.log(`LISTO: ${done} creadas.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
