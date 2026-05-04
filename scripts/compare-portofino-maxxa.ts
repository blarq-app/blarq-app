// Comparador BLARQ vs Maxxa para el proyecto Portofino.
// Lee el .xls (HTML) que MJ exporta de Maxxa y compara contra las facturas
// que tiene la BD de BLARQ asignadas a Portofino. Reporta diferencias para
// ubicar el origen del descalce.

import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

const MAXXA_FILE = "/Users/mjblanco/Downloads/DetallesCentroCosto (8).xls";

interface MaxxaRow {
  rutDoc: string;
  nomAux: string;
  tipoDoc: string; // texto humano del Maxxa
  detalleTipo: string;
  folioDoc: string;
  fechaDoc: string;
  montoTotal: number; // monto base del documento
  montoNC: number; // monto de la(s) NC asociada(s)
  montoND: number; // monto de la(s) ND asociada(s)
  centroCosto: string;
  observacion: string;
  origen: string;
  folioDocRef: string;
}

function parseMaxxa(): MaxxaRow[] {
  const html = readFileSync(MAXXA_FILE, "utf-8");
  const $ = cheerio.load(html);
  const rows = $("table tr");
  const headers = rows.first().find("td").map((_, td) => $(td).text().trim()).get();
  const idx = (name: string) => headers.indexOf(name);

  const out: MaxxaRow[] = [];
  rows.slice(1).each((_, tr) => {
    const tds = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    if (tds.length < headers.length / 2) return;
    out.push({
      rutDoc: tds[idx("RutDoc")] ?? "",
      nomAux: tds[idx("NomAux")] ?? "",
      tipoDoc: tds[idx("CodTipoDoc")] ?? "",
      detalleTipo: tds[idx("DetalleTipo")] ?? "",
      folioDoc: tds[idx("FolioDoc")] ?? "",
      fechaDoc: tds[idx("FechaDoc")] ?? "",
      montoTotal: parseNum(tds[idx("MontoTotal")] ?? "0"),
      montoNC: parseNum(tds[idx("MontoNC")] ?? "0"),
      montoND: parseNum(tds[idx("MontoND")] ?? "0"),
      centroCosto: tds[idx("CentroCosto")] ?? "",
      observacion: tds[idx("Observacion")] ?? "",
      origen: tds[idx("Origen")] ?? "",
      folioDocRef: tds[idx("FolioDocRef")] ?? "",
    });
  });
  return out;
}

function parseNum(s: string): number {
  const cleaned = s.replace(/[.\s$]/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function tipoDocHumano(t: number | null): string {
  if (t === 33) return "FE";
  if (t === 34) return "FE Exenta";
  if (t === 56) return "ND";
  if (t === 61) return "NC";
  if (t === 39) return "Boleta";
  return `?${t}`;
}

async function main() {
  console.log("=== Comparando BLARQ vs Maxxa para proyecto Portofino ===\n");

  // 1. Buscar el proyecto Portofino en BD.
  const portofino = await prisma.project.findFirst({
    where: { name: { contains: "Portofino", mode: "insensitive" } },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!portofino) {
    console.error("❌ No se encontró proyecto 'Portofino' en BD");
    process.exit(1);
  }
  console.log(`Proyecto BLARQ: "${portofino.name}" (${portofino.numeroProyecto ?? "—"}, id=${portofino.id})\n`);

  // 2. Cargar facturas BLARQ del proyecto.
  const blarqInvoices = await prisma.invoice.findMany({
    where: { projectId: portofino.id, type: "recibida" },
    orderBy: [{ tipoDoc: "asc" }, { folioNumber: "asc" }],
    select: {
      id: true,
      tipoDoc: true,
      folioNumber: true,
      rutIssuer: true,
      businessName: true,
      issueDate: true,
      netAmount: true,
      iva: true,
      totalAmount: true,
      referenceFolioNumber: true,
      referenceTipoDoc: true,
    },
  });

  // 3. Cargar Maxxa del proyecto.
  const maxxaAll = parseMaxxa();
  // Filtramos por CentroCosto que matchee Portofino. Inspecciono qué
  // CentroCosto vienen primero.
  const cc = Array.from(new Set(maxxaAll.map((r) => r.centroCosto))).sort();
  console.log(`CentroCosto encontrados en Maxxa export: ${cc.length}`);
  cc.forEach((c) => console.log(`  - ${c}`));

  // Filtrar a Portofino. Heurística: por nombre.
  const maxxaRows = maxxaAll.filter((r) => /portofino/i.test(r.centroCosto));
  console.log(`\nFilas Maxxa Portofino: ${maxxaRows.length}`);
  console.log(`Filas BLARQ Portofino (recibidas): ${blarqInvoices.length}\n`);

  // 4. Comparar por (rutDoc, folioDoc) — la clave natural.
  // Construir índices en ambos lados.
  const blarqByKey = new Map<string, typeof blarqInvoices[0]>();
  for (const inv of blarqInvoices) {
    const rut = String(inv.rutIssuer ?? "").split("-")[0];
    const key = `${rut}|${inv.folioNumber ?? ""}|${inv.tipoDoc ?? ""}`;
    blarqByKey.set(key, inv);
  }

  const maxxaByKey = new Map<string, MaxxaRow>();
  for (const r of maxxaRows) {
    // tipoDoc en Maxxa viene como string "33", "61", etc.
    const key = `${r.rutDoc.split("-")[0]}|${r.folioDoc}|${r.tipoDoc}`;
    maxxaByKey.set(key, r);
  }

  // 5. Reportar discrepancias.
  const onlyInMaxxa: MaxxaRow[] = [];
  const onlyInBlarq: typeof blarqInvoices = [];
  const both: Array<{ blarq: typeof blarqInvoices[0]; maxxa: MaxxaRow }> = [];

  for (const [k, m] of maxxaByKey) {
    const b = blarqByKey.get(k);
    if (b) both.push({ blarq: b, maxxa: m });
    else onlyInMaxxa.push(m);
  }
  for (const [k, b] of blarqByKey) {
    if (!maxxaByKey.has(k)) onlyInBlarq.push(b);
  }

  // Totales.
  const totBlarqFE = blarqInvoices.filter((i) => i.tipoDoc === 33 || i.tipoDoc === 34).reduce((s, i) => s + i.totalAmount, 0);
  const totBlarqNC = blarqInvoices.filter((i) => i.tipoDoc === 61).reduce((s, i) => s + i.totalAmount, 0);
  const totBlarqND = blarqInvoices.filter((i) => i.tipoDoc === 56).reduce((s, i) => s + i.totalAmount, 0);
  const totBlarqNeto = totBlarqFE + totBlarqND - totBlarqNC;

  const totMaxxaFE = maxxaRows.filter((r) => r.tipoDoc === "33" || r.tipoDoc === "34").reduce((s, r) => s + r.montoTotal, 0);
  const totMaxxaNC = maxxaRows.filter((r) => r.tipoDoc === "61").reduce((s, r) => s + r.montoTotal, 0);
  const totMaxxaND = maxxaRows.filter((r) => r.tipoDoc === "56").reduce((s, r) => s + r.montoTotal, 0);
  const totMaxxaNeto = totMaxxaFE + totMaxxaND - totMaxxaNC;

  console.log("─── TOTALES ──────────────────────────────────────────────");
  console.log(`                    BLARQ          Maxxa          Δ`);
  console.log(`Facturas (33+34)   ${fmt(totBlarqFE)}   ${fmt(totMaxxaFE)}   ${fmt(totBlarqFE - totMaxxaFE)}`);
  console.log(`Notas Crédito (61) ${fmt(totBlarqNC)}   ${fmt(totMaxxaNC)}   ${fmt(totBlarqNC - totMaxxaNC)}`);
  console.log(`Notas Débito (56)  ${fmt(totBlarqND)}   ${fmt(totMaxxaND)}   ${fmt(totBlarqND - totMaxxaND)}`);
  console.log(`NETO (FE+ND-NC)    ${fmt(totBlarqNeto)}   ${fmt(totMaxxaNeto)}   ${fmt(totBlarqNeto - totMaxxaNeto)}`);
  console.log("");

  console.log(`─── EN MAXXA, NO EN BLARQ (${onlyInMaxxa.length}) ───────────────────────`);
  for (const r of onlyInMaxxa) {
    console.log(`  ${r.tipoDoc.padStart(2)} folio=${r.folioDoc.padStart(10)} rut=${r.rutDoc.padEnd(13)} ${fmt(r.montoTotal).padStart(14)}  ${r.nomAux.slice(0, 35)}`);
  }
  console.log("");

  console.log(`─── EN BLARQ, NO EN MAXXA (${onlyInBlarq.length}) ───────────────────────`);
  for (const inv of onlyInBlarq) {
    console.log(`  ${tipoDocHumano(inv.tipoDoc).padEnd(10)} folio=${(inv.folioNumber ?? "").padStart(10)} rut=${(inv.rutIssuer ?? "").padEnd(13)} ${fmt(inv.totalAmount).padStart(14)}  ${(inv.businessName ?? "").slice(0, 35)}`);
  }
  console.log("");

  console.log(`─── EN AMBOS PERO MONTO DIFIERE ─────────────────────────`);
  let diffCount = 0;
  for (const { blarq, maxxa } of both) {
    if (Math.abs(blarq.totalAmount - maxxa.montoTotal) > 1) {
      diffCount++;
      console.log(`  ${tipoDocHumano(blarq.tipoDoc).padEnd(10)} folio=${(blarq.folioNumber ?? "").padStart(10)} rut=${(blarq.rutIssuer ?? "").padEnd(13)}  BLARQ ${fmt(blarq.totalAmount)}  Maxxa ${fmt(maxxa.montoTotal)}  Δ ${fmt(blarq.totalAmount - maxxa.montoTotal)}  ${(blarq.businessName ?? "").slice(0, 30)}`);
    }
  }
  if (diffCount === 0) console.log("  (ninguna)");
  console.log("");

  await prisma.$disconnect();
}

function fmt(n: number): string {
  return n.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
