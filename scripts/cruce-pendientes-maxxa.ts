// READ-ONLY — reconstruye el desglose de las facturas recibidas que la app
// muestra PENDIENTE/PARCIAL y las cruza contra lo que dice Maxxa, para separar:
//
//   ALINEADA   — Maxxa también la tiene impaga (saldo > 0). OK, no es hueco.
//   HUECO      — Maxxa la tiene PAGADA (saldo ≈ 0) pero la app la muestra
//                pendiente → falta enganchar su movimiento. (el objetivo)
//   2026       — factura emitida en 2026 (fuera del export Maxxa 2025, no comparable).
//   NO_EN_MAXXA— factura 2025 que NO aparece en el export de Maxxa (chica).
//
// Para cada HUECO, además busca en las CARTOLAS de Maxxa (col Asignacion =
// verdad manual de MJ) cuál(es) movimiento(s) la pagó, y mira si ese mov está
// en la app y si está libre → así sabemos cuáles son enganchables mecánicamente.
//
// NO escribe nada a la BD. Escribe un Excel con el detalle de las HUECO y las
// NO_EN_MAXXA para revisar.
//
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/cruce-pendientes-maxxa.ts

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const core = (s: any) => norm(s).replace(/^\d+\s*/, "").replace(/\s+/g, " ").trim();
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── 1. app: facturas recibidas pendiente/parcial (las ~203) ──
  const invs = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 }, status: { in: ["pendiente", "parcial"] } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, issueDate: true, projectId: true, payments: { select: { amountApplied: true } } },
  });
  const paidOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);

  // ── 2. export Maxxa 2025: folio|rut → {pago, saldo, total, glosa, nom, cc} ──
  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = rows[0]; const ci = (n: string) => H.indexOf(n);
  const cF = ci("FolioDoc"), cR = ci("RutDoc"), cN = ci("NomAux"), cTot = ci("MontoTotal"), cP = ci("MontoPago"), cS = ci("Saldo"), cD = ci("DetallePago"), cC = ci("CentroCosto"), cAnul = ci("Anulada");
  const maxxa = new Map<string, { pago: number; saldo: number; total: number; glosa: string; nom: string; cc: string }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[cAnul]).toLowerCase() === "si") continue;
    const k = `${noZero(r[cF])}|${rut8(r[cR])}`;
    if (k === "|") continue;
    maxxa.set(k, { pago: Number(r[cP]) || 0, saldo: Number(r[cS]) || 0, total: Number(r[cTot]) || 0, glosa: String(r[cD] ?? "").trim(), nom: String(r[cN] ?? ""), cc: String(r[cC] ?? "") });
  }

  // ── 3. cartolas Maxxa (col Asignacion) → por factura, los movs que MJ le asignó ──
  const cartolaFiles = [
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260601_1722.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2355.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2356.xlsx"),
  ];
  type CMov = { date: string; amount: number; glosa: string };
  const movsPorFactura = new Map<string, CMov[]>(); // folio|rut → movs
  const seen = new Set<string>();
  for (const f of cartolaFiles) {
    let raw: any[];
    try { raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" }); } catch { continue; }
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (r[4] === "") continue;
      let arr: any[] = [];
      if (r[27]) { try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { arr = []; } }
      const idp = arr[0]?.id_pago ? String(arr[0].id_pago) : `row-${r[3]}-${r[4]}-${r[7]}`;
      if (seen.has(idp)) continue;
      seen.add(idp);
      const mov: CMov = { date: String(r[7]).slice(0, 10), amount: Math.abs(Number(r[4]) || 0), glosa: String(r[3] ?? "") };
      for (const a of arr) {
        const k = `${noZero(a.Folio)}|${rut8(a.Rut)}`;
        if (k === "|") continue;
        if (!movsPorFactura.has(k)) movsPorFactura.set(k, []);
        movsPorFactura.get(k)!.push(mov);
      }
    }
  }

  // ── 4. movimientos de la app (para ver si el mov que cita la cartola está libre) ──
  const appMovs = await prisma.bankMovement.findMany({
    where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { invoiceId: true, amountApplied: true } } },
  });
  // capacidad libre de un mov = |monto| − suma ya aplicada en la app
  const freeCap = (m: any) => Math.abs(m.amount) - m.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);
  const findAppMov = (m: CMov) => {
    const byAmt = appMovs.filter((x) => Math.abs(Math.abs(x.amount) - m.amount) <= 2);
    if (byAmt.length === 1) return byAmt[0];
    // desempatar por fecha (±3d) y glosa
    const g = core(m.glosa);
    const byBoth = byAmt.filter((x) => { const cg = core(x.description); return cg && g && (cg.startsWith(g.slice(0, 12)) || g.startsWith(cg.slice(0, 12))); });
    if (byBoth.length === 1) return byBoth[0];
    const byDate = byAmt.filter((x) => Math.abs(new Date(x.date).getTime() - new Date(m.date + "T00:00:00Z").getTime()) <= 3 * 864e5);
    return byDate.length === 1 ? byDate[0] : null;
  };

  // ── 5. clasificar las 203 ──
  type Row = { folio: string; rut: string; prov: string; total: number; saldoApp: number; estadoApp: string; year: number; obra: string;
    bucket: string; maxxaPago: number; maxxaSaldo: number; glosaMaxxa: string; planMov: string };
  const all: Row[] = [];
  for (const inv of invs) {
    const folio = noZero(inv.folioNumber); const rut = rut8(inv.rutIssuer);
    const k = `${folio}|${rut}`;
    const year = new Date(inv.issueDate).getUTCFullYear();
    const saldoApp = inv.totalAmount - paidOf(inv);
    const base: Row = { folio, rut, prov: inv.businessName ?? "", total: inv.totalAmount, saldoApp, estadoApp: inv.status, year, obra: inv.projectId ?? "",
      bucket: "", maxxaPago: 0, maxxaSaldo: 0, glosaMaxxa: "", planMov: "" };
    if (year >= 2026) { base.bucket = "2026"; all.push(base); continue; }
    const mx = maxxa.get(k);
    if (!mx) { base.bucket = "NO_EN_MAXXA"; all.push(base); continue; }
    base.maxxaPago = mx.pago; base.maxxaSaldo = mx.saldo; base.glosaMaxxa = mx.glosa;
    // El hueco REAL = Maxxa pagó MÁS que lo que la app aplicó. La columna "Saldo"
    // del export NO sirve (Maxxa infla el MontoTotal ×100 y el saldo se desincroniza);
    // MontoPago sí es real. Comparamos pago-Maxxa vs aplicado-app.
    const appApplied = paidOf(inv);
    const gap = mx.pago - appApplied;
    if (gap <= 1) { base.bucket = "ALINEADA"; all.push(base); continue; } // app ya aplicó >= lo de Maxxa
    base.bucket = "HUECO"; base.maxxaSaldo = gap; // reuso el campo para mostrar el gap real
    const movs = movsPorFactura.get(k) ?? [];
    if (!movs.length) {
      base.planMov = base.glosaMaxxa ? `cartola no lo lista; export dice mov "${base.glosaMaxxa.slice(0, 30)}"` : "no encuentro el mov ni en cartola ni en export";
    } else {
      const partes = movs.map((m) => {
        const am = findAppMov(m);
        if (!am) return `${m.date} ${fmt(m.amount)} "${m.glosa.slice(0, 20)}" → mov NO está en la app`;
        const linked = am.payments.map((p) => p.invoiceId);
        const libre = freeCap(am);
        if (linked.includes(inv.id)) return `${m.date} ${fmt(m.amount)} → YA enganchado (libre ${fmt(libre)})`;
        if (libre > 1) return `${m.date} ${fmt(m.amount)} "${am.description.slice(0, 18)}" → tiene ${fmt(libre)} LIBRE ✓`;
        return `${m.date} ${fmt(m.amount)} → mov SIN capacidad (en ${linked.length} fact)`;
      });
      base.planMov = partes.join(" | ");
    }
    all.push(base);
  }

  // ── 6. resumen ──
  const buckets = ["HUECO", "ALINEADA", "2026", "NO_EN_MAXXA"];
  console.log(`Facturas recibidas pendiente/parcial en la app: ${all.length}\n`);
  for (const b of buckets) {
    const g = all.filter((x) => x.bucket === b);
    const monto = g.reduce((s, x) => s + x.saldoApp, 0);
    console.log(`  ${String(g.length).padStart(4)} · saldo ${fmt(monto).padStart(13)}  ${b}`);
  }

  // detalle HUECO en consola
  const hueco = all.filter((x) => x.bucket === "HUECO").sort((a, b) => b.saldoApp - a.saldoApp);
  const conLibre = hueco.filter((x) => x.planMov.includes("LIBRE ✓")).length;
  const totGap = hueco.reduce((s, x) => s + x.maxxaSaldo, 0);
  console.log(`\n── HUECO (${hueco.length}) — Maxxa pagó MÁS que la app · falta enganchar ${fmt(totGap)} ──`);
  console.log(`   de las cuales ${conLibre} tienen un mov con capacidad LIBRE (candidato a enganche)\n`);
  for (const x of hueco.sort((a, b) => b.maxxaSaldo - a.maxxaSaldo)) {
    console.log(`  f${x.folio} ${x.prov.slice(0, 26).padEnd(26)} Maxxa pagó ${fmt(x.maxxaPago).padStart(12)} · app aplicó ${fmt(x.total - x.saldoApp).padStart(11)} · falta ${fmt(x.maxxaSaldo).padStart(11)} [${x.estadoApp}]`);
    console.log(`      ${x.planMov}`);
  }

  // detalle NO_EN_MAXXA en consola
  const noMxList = all.filter((x) => x.bucket === "NO_EN_MAXXA").sort((a, b) => b.saldoApp - a.saldoApp);
  console.log(`\n── NO_EN_MAXXA (${noMxList.length}) — factura 2025 que no aparece en el export de Maxxa ──\n`);
  for (const x of noMxList) console.log(`  f${x.folio} ${x.prov.slice(0, 30).padEnd(30)} saldo ${fmt(x.saldoApp).padStart(12)} [${x.estadoApp}] año ${x.year}`);

  // ── 7. Excel ──
  const toSheet = (list: Row[]) => XLSX.utils.json_to_sheet(list.map((x) => ({
    Folio: x.folio, Proveedor: x.prov, "Total factura": x.total, "Saldo app": x.saldoApp, "Estado app": x.estadoApp, Año: x.year,
    "Maxxa pagó": x.maxxaPago, "Maxxa saldo": x.maxxaSaldo, "Glosa mov (export)": x.glosaMaxxa, "Plan (cartola)": x.planMov,
  })));
  const wbo = XLSX.utils.book_new();
  const wsH = toSheet(hueco); wsH["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 11 }, { wch: 32 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wbo, wsH, "HUECO (53)");
  const noMx = all.filter((x) => x.bucket === "NO_EN_MAXXA").sort((a, b) => b.saldoApp - a.saldoApp);
  const wsN = toSheet(noMx); wsN["!cols"] = wsH["!cols"];
  XLSX.utils.book_append_sheet(wbo, wsN, "NO_EN_MAXXA (19)");
  const p = join(homedir(), "Downloads", "Pendientes_app_vs_Maxxa.xlsx");
  XLSX.writeFile(wbo, p);
  console.log(`\nExcel: ${p}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
