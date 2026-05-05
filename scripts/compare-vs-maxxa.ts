// Comparador genérico BLARQ vs Maxxa para cualquier proyecto.
//
// Uso:
//   npx tsx scripts/compare-vs-maxxa.ts <projectName> <maxxaExportPath>
//
// Ejemplo:
//   npx tsx scripts/compare-vs-maxxa.ts Portofino "/Users/mjblanco/Downloads/DetallesCentroCosto (8).xls"
//
// Lee el .xls (HTML) que MJ exporta de Maxxa (Reporte → DetallesCentroCosto)
// y compara contra las facturas de la BD BLARQ asignadas al proyecto.
//
// El "projectName" se usa para:
//   1) matchear el nombre del proyecto en BD (contains, case-insensitive),
//   2) filtrar las filas Maxxa por CentroCosto (regex, case-insensitive).
// Si el CentroCosto en Maxxa no coincide con el nombre del proyecto en BLARQ,
// pasarle un --cc <patrón> para overridear el filtro.
//
//   npx tsx scripts/compare-vs-maxxa.ts "Casa MJ" /path/export.xls --cc "MJB"

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

interface MaxxaRow {
  rutDoc: string;
  nomAux: string;
  tipoDoc: string;
  detalleTipo: string;
  folioDoc: string;
  fechaDoc: string;
  montoTotal: number;
  montoNC: number;
  montoND: number;
  centroCosto: string;
  observacion: string;
  origen: string;
  folioDocRef: string;
}

interface CliArgs {
  projectName: string;
  maxxaPath: string;
  ccPattern: string; // patrón regex para filtrar CentroCosto; default = projectName
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  let ccPattern: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cc") {
      ccPattern = argv[++i] ?? "";
    } else if (a.startsWith("--cc=")) {
      ccPattern = a.slice("--cc=".length);
    } else if (a === "-h" || a === "--help") {
      printUsage();
      process.exit(0);
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 2) {
    printUsage();
    process.exit(1);
  }

  return {
    projectName: positional[0],
    maxxaPath: positional[1],
    ccPattern: ccPattern ?? positional[0],
  };
}

function printUsage() {
  console.log("Uso: npx tsx scripts/compare-vs-maxxa.ts <projectName> <maxxaExportPath> [--cc <patrón>]");
  console.log("");
  console.log("  projectName        Nombre (parcial) del proyecto en BLARQ (contains, case-insensitive)");
  console.log("  maxxaExportPath    Ruta al .xls (HTML) exportado de Maxxa");
  console.log("  --cc <patrón>      (opcional) Patrón regex para filtrar Maxxa por CentroCosto.");
  console.log("                     Default: el mismo projectName.");
}

function parseMaxxa(filePath: string): MaxxaRow[] {
  const html = readFileSync(filePath, "utf-8");
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
      // Maxxa exporta NCs con signo negativo en MontoTotal; BLARQ guarda
      // todos los Invoice.totalAmount en positivo y resta NCs al computar
      // el neto. Normalizamos a |x| acá para que ambos lados coincidan.
      montoTotal: Math.abs(parseNum(tds[idx("MontoTotal")] ?? "0")),
      montoNC: Math.abs(parseNum(tds[idx("MontoNC")] ?? "0")),
      montoND: Math.abs(parseNum(tds[idx("MontoND")] ?? "0")),
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
  const args = parseArgs();

  if (!existsSync(args.maxxaPath)) {
    console.error(`❌ No existe el archivo Maxxa: ${args.maxxaPath}`);
    process.exit(1);
  }

  console.log(`=== Comparando BLARQ vs Maxxa para "${args.projectName}" ===\n`);

  const project = await prisma.project.findFirst({
    where: { name: { contains: args.projectName, mode: "insensitive" } },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!project) {
    console.error(`❌ No se encontró ningún proyecto que matchee "${args.projectName}" en BD`);
    process.exit(1);
  }
  console.log(`Proyecto BLARQ: "${project.name}" (${project.numeroProyecto ?? "—"}, id=${project.id})\n`);

  const blarqInvoices = await prisma.invoice.findMany({
    where: { projectId: project.id, type: "recibida" },
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

  const maxxaAll = parseMaxxa(args.maxxaPath);
  const cc = Array.from(new Set(maxxaAll.map((r) => r.centroCosto))).sort();
  console.log(`CentroCosto encontrados en Maxxa export: ${cc.length}`);
  cc.forEach((c) => console.log(`  - ${c}`));

  // Validamos el patrón antes de filtrar para dar mensaje útil.
  let ccRegex: RegExp;
  try {
    ccRegex = new RegExp(args.ccPattern, "i");
  } catch (e) {
    console.error(`❌ Patrón --cc inválido como regex: ${args.ccPattern}`);
    process.exit(1);
  }

  const maxxaRows = maxxaAll.filter((r) => ccRegex.test(r.centroCosto));
  console.log(`\nFilas Maxxa con CentroCosto ~ /${args.ccPattern}/i: ${maxxaRows.length}`);
  console.log(`Filas BLARQ (recibidas) en proyecto: ${blarqInvoices.length}\n`);

  if (maxxaRows.length === 0) {
    console.error(
      `⚠️  No hay filas Maxxa que matcheen el patrón /${args.ccPattern}/i.\n` +
        `   Si el CentroCosto en Maxxa difiere del nombre BLARQ, pasale --cc "<patrón>".`,
    );
  }

  const blarqByKey = new Map<string, typeof blarqInvoices[0]>();
  for (const inv of blarqInvoices) {
    const rut = String(inv.rutIssuer ?? "").split("-")[0];
    const key = `${rut}|${inv.folioNumber ?? ""}|${inv.tipoDoc ?? ""}`;
    blarqByKey.set(key, inv);
  }

  const maxxaByKey = new Map<string, MaxxaRow>();
  for (const r of maxxaRows) {
    const key = `${r.rutDoc.split("-")[0]}|${r.folioDoc}|${r.tipoDoc}`;
    maxxaByKey.set(key, r);
  }

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
