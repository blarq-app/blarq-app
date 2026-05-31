// CRUCE READ-ONLY — pagos a maestros sin factura (tipoDoc 1043) Maxxa 2025
// vs lo que YA está en la app. NO escribe nada (solo findMany).
//
// Por cada 1043 de una obra de cliente que existe en la app, determina:
//  - YA EXISTE   : ya hay una factura sin_respaldo/1043 para ese folio+rut o
//                  por (proyecto+rut+monto) → saltar, no duplicar.
//  - CREAR+CONC  : no existe y hay un movimiento del banco que calza
//                  (RUT+monto+fecha) sin imputar → candidato limpio.
//  - CREAR S/MOV : no existe pero no se encontró movimiento → decidir con MJ.
//  - SIN PROYECTO: el centro de costo no tiene proyecto en la app (Terraza 34).
//
// Internos de BLARQ (00_*, sin CC) quedan fuera por decisión de MJ.
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

const EXPORT = "/Users/mjblanco/Downloads/2025_Maxxa/exportar (2).xls";
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));
const normRut = (r: string) => String(r || "").replace(/[.\s]/g, "").toUpperCase();
const rutBody = (r: string) => normRut(r).replace(/-/g, "").replace(/[0-9kK]$/, ""); // sin DV
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const days = (a: Date | string, b: Date | string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

type R = { folio: string; rut: string; nom: string; cc: string; fecha: string; monto: number };

function load1043(): R[] {
  const $ = cheerio.load(readFileSync(EXPORT, "utf-8"));
  const rows = $("table tr");
  const H = rows.first().find("td").map((_, td) => $(td).text().trim()).get();
  const gi = (n: string) => H.indexOf(n);
  const out: R[] = [];
  rows.slice(1).each((_, tr) => {
    const t = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    if (t.length < 10) return;
    if (Number(t[gi("CodTipoDoc")]) !== 1043) return;
    out.push({
      folio: String(t[gi("FolioDoc")]).trim(),
      rut: t[gi("RutDoc")],
      nom: t[gi("NomAux")],
      cc: t[gi("CentroCosto")],
      fecha: t[gi("FechaDoc")],
      monto: num(t[gi("MontoTotal")]),
    });
  });
  return out;
}

async function main() {
  const isProd = /ep-shy-morning/.test(process.env.DATABASE_URL ?? "");
  console.log(`Entorno: ${isProd ? "PROD" : "?"} | READ-ONLY (no escribe nada)\n`);

  const all = load1043();
  // separar: 00_* y sin CC = interno (fuera). Resto = obra (tiene prefijo n°).
  const obra = all.filter((r) => /^\d+_/.test(r.cc));
  const interno = all.filter((r) => !/^\d+_/.test(r.cc));
  console.log(`1043 totales: ${all.length} | de obra: ${obra.length} | internos (fuera): ${interno.length}\n`);

  // proyectos por numeroProyecto
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, numeroProyecto: true },
  });
  const projByNum = new Map(projects.filter((p) => p.numeroProyecto != null).map((p) => [String(p.numeroProyecto), p]));

  // facturas de esos proyectos (para detectar ya-existe)
  const projIds = [...new Set(obra.map((r) => projByNum.get(r.cc.match(/^(\d+)_/)![1])?.id).filter(Boolean))] as string[];
  const invs = await prisma.invoice.findMany({
    where: { projectId: { in: projIds }, type: "recibida" },
    select: { id: true, projectId: true, tipoDoc: true, folioNumber: true, rutIssuer: true, totalAmount: true, origin: true, status: true },
  });

  // movimientos egreso 2025 con imputaciones (para candidatos)
  const movs = await prisma.bankMovement.findMany({
    where: { amount: { lt: 0 }, date: { gte: new Date("2025-01-01"), lte: new Date("2026-01-31T23:59:59") } },
    select: { id: true, date: true, amount: true, counterpartyRut: true, counterpartyName: true, description: true, externalRef: true, payments: { select: { id: true } } },
  });

  type Row = R & { proj: any; estado: string; detalle: string; movId?: string };
  const result: Row[] = [];
  for (const r of obra) {
    const n = r.cc.match(/^(\d+)_/)![1];
    const proj = projByNum.get(n);
    if (!proj) {
      result.push({ ...r, proj: null, estado: "SIN PROYECTO", detalle: `centro de costo ${r.cc} no existe en la app` });
      continue;
    }
    // ¿ya existe?
    const exist = invs.find(
      (i) =>
        i.projectId === proj.id &&
        ((i.tipoDoc === 1043 && String(i.folioNumber).trim() === r.folio && normRut(i.rutIssuer || "") === normRut(r.rut)) ||
          ((i.origin === "sin_respaldo" || i.origin === "maxxa_sin_respaldo") &&
            normRut(i.rutIssuer || "") === normRut(r.rut) &&
            Math.abs(i.totalAmount - r.monto) < 1))
    );
    if (exist) {
      result.push({ ...r, proj, estado: "YA EXISTE", detalle: `factura ${exist.origin} ${exist.folioNumber} (${exist.status})` });
      continue;
    }
    // candidato de movimiento (egreso, mismo monto, mismo RUT, ±7d, sin imputar)
    const body = rutBody(r.rut);
    const cands = movs
      .filter((m) => Math.abs(Math.round(m.amount)) === Math.round(r.monto) && body && normRut(m.counterpartyRut || "").replace(/-/g, "").includes(body) && days(m.date, r.fecha) <= 7)
      .sort((a, b) => days(a.date, r.fecha) - days(b.date, r.fecha));
    const free = cands.filter((m) => m.payments.length === 0);
    if (free.length) {
      const m = free[0];
      result.push({ ...r, proj, estado: "CREAR+CONC", detalle: `mov ${ymd(m.date)} ${fmt(Math.abs(m.amount))} [${m.counterpartyRut}] ref ${m.externalRef || m.id}`, movId: m.id });
    } else if (cands.length) {
      result.push({ ...r, proj, estado: "CREAR S/MOV", detalle: `hay mov pero YA imputado (${ymd(cands[0].date)}) → revisar` });
    } else {
      result.push({ ...r, proj, estado: "CREAR S/MOV", detalle: "sin movimiento que calce por RUT+monto+fecha" });
    }
  }

  // imprimir por obra
  const byCC: Record<string, Row[]> = {};
  for (const r of result) (byCC[r.cc] = byCC[r.cc] || []).push(r);
  const order = Object.entries(byCC).sort((a, b) => b[1].reduce((s, r) => s + r.monto, 0) - a[1].reduce((s, r) => s + r.monto, 0));
  for (const [cc, arr] of order) {
    const tot = arr.reduce((s, r) => s + r.monto, 0);
    console.log(`\n══ ${cc} — ${arr.length} regs, Σ ${fmt(tot)} ══`);
    for (const r of arr.sort((a, b) => b.monto - a.monto)) {
      console.log(`  [${r.estado.padEnd(11)}] F-${r.folio.padEnd(4)} ${fmt(r.monto).padStart(11)} ${r.fecha} ${r.nom.slice(0, 28).padEnd(28)} ${r.detalle}`);
    }
  }

  // resumen por estado
  console.log("\n══════ RESUMEN POR ESTADO ══════");
  const byEst: Record<string, { n: number; m: number }> = {};
  for (const r of result) { byEst[r.estado] = byEst[r.estado] || { n: 0, m: 0 }; byEst[r.estado].n++; byEst[r.estado].m += r.monto; }
  for (const [e, v] of Object.entries(byEst)) console.log(`  ${e.padEnd(12)}: ${v.n} regs, ${fmt(v.m)}`);

  // COLISIONES: un mismo movimiento reclamado por >1 registro CREAR+CONC
  const byMov: Record<string, Row[]> = {};
  for (const r of result) if (r.movId) (byMov[r.movId] = byMov[r.movId] || []).push(r);
  const colls = Object.entries(byMov).filter(([, rs]) => rs.length > 1);
  console.log(`\n══════ COLISIONES (1 mov ↔ varios 1043): ${colls.length} ══════`);
  for (const [mid, rs] of colls) {
    console.log(`  mov ${mid} (${ymd(rs[0].fecha)} ${fmt(rs[0].monto)}) reclamado por:`);
    rs.forEach((r) => console.log(`     F-${r.folio} ${r.cc} ${r.nom}`));
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
