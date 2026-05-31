// FASE A — Traer los pagos a maestros sin factura (tipoDoc 1043) de Maxxa 2025
// como costo de sus obras, replicando "Pago sin factura": por cada 1043 crea
// un Invoice recibida sin_respaldo (origin maxxa_sin_respaldo, folio = folio
// Maxxa, IVA 0) + InvoicePayment contra la transferencia real del banco +
// marca el movimiento conciliado. Respeta la categoría de Maxxa.
//
// Reglas:
//  - Solo obras de cliente que existen (41,48,45,43,49). Casa Arrau (46) ya
//    está cargado → no entra. Internos 00_* / sin CC → fuera.
//  - Solo MANO DE OBRA y SUBCONTRATO. Los TRASPASOS ENTRE CUENTAS se EXCLUYEN
//    (no son costo de obra — caso F-167 Patricia $4M, F-164 Studio Group).
//  - Solo los que tienen una transferencia que calza (RUT+monto+±7d) sin
//    imputar. Los sin movimiento quedan para Fase B.
//  - Asignación de movimientos sin colisión: si dos 1043 reclaman el mismo
//    movimiento, gana el de fecha más cercana; el otro queda Fase B.
//  - Idempotente: salta los que ya existen (dte_unique) o cuyo mov ya tiene
//    imputación. Escrituras secuenciales (el pooler de Neon no soporta
//    transacciones interactivas).
//
// Dry-run por default. --apply escribe. --obra=NN limita la escritura a una obra
// (el dry-run siempre muestra las 5).
import "dotenv/config";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const OBRA_ARG = process.argv.find((a) => a.startsWith("--obra="))?.split("=")[1];
const EXPORT = "/Users/mjblanco/Downloads/2025_Maxxa/exportar (2).xls";
const BLARQ_RUT = "77270733-9";
const OBRAS = ["41", "48", "45", "43", "49"];

const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));
const normRut = (r: string) => String(r || "").replace(/[.\s]/g, "").toUpperCase();
const rutBody = (r: string) => normRut(r).replace(/-/g, "").replace(/[0-9kK]$/, "");
const nc = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const days = (a: Date | string, b: Date | string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

// sinónimos Maxxa(normalizado) → nombre exacto de categoría en la app
const SYN: Record<string, string> = {
  manodeobra: "Mano de obra", subcontrato: "Subcontrato",
  retiroescombrosflete: "Subcontrato / Flete / Retiro escombros",
};

type R = { folio: string; rut: string; nom: string; cc: string; fecha: string; monto: number; cat: string; sub: string };

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
    const cc = t[gi("CentroCosto")];
    if (!OBRAS.some((n) => cc.startsWith(n + "_"))) return;
    out.push({
      folio: String(t[gi("FolioDoc")]).trim(), rut: t[gi("RutDoc")], nom: t[gi("NomAux")],
      cc, fecha: t[gi("FechaDoc")], monto: num(t[gi("MontoTotal")]),
      cat: t[gi("DescCatego")] || "", sub: t[gi("DescSubCatego")] || "",
    });
  });
  return out;
}

async function main() {
  const isProd = /ep-shy-morning/.test(process.env.DATABASE_URL ?? "");
  console.log(`Entorno: ${isProd ? "PROD" : "?"} | modo: ${APPLY ? "APPLY" : "DRY-RUN"}${OBRA_ARG ? ` | obra=${OBRA_ARG}` : ""}\n`);

  const recs = load1043();
  const projects = await prisma.project.findMany({ select: { id: true, name: true, numeroProyecto: true } });
  const projByNum = new Map(projects.filter((p) => p.numeroProyecto != null).map((p) => [String(p.numeroProyecto), p]));
  const cats = await prisma.costCategory.findMany();
  const catByNorm = new Map<string, any>();
  for (const c of cats) { const parent = c.parentId ? cats.find((x) => x.id === c.parentId) : null; const full = (parent ? parent.name + " / " : "") + c.name; catByNorm.set(nc(full), c); catByNorm.set(nc(c.name), c); }

  function resolveCat(cat: string, sub: string): { id: string; name: string } | null {
    const cands = []; if (sub && !["null", "undefined", ""].includes(String(sub).toLowerCase().trim())) cands.push(sub); cands.push(cat);
    for (const c of cands) { const k = nc(c); if (SYN[k] && catByNorm.has(nc(SYN[k]))) { const x = catByNorm.get(nc(SYN[k])); return { id: x.id, name: x.name }; } if (catByNorm.has(k)) { const x = catByNorm.get(k); return { id: x.id, name: x.name }; } }
    return null;
  }

  const projIds = OBRAS.map((n) => projByNum.get(n)?.id).filter(Boolean) as string[];
  const invs = await prisma.invoice.findMany({ where: { projectId: { in: projIds }, type: "recibida" }, select: { projectId: true, tipoDoc: true, folioNumber: true, rutIssuer: true, totalAmount: true, origin: true } });
  const movs = await prisma.bankMovement.findMany({
    where: { amount: { lt: 0 }, date: { gte: new Date("2025-01-01"), lte: new Date("2026-01-31T23:59:59") } },
    select: { id: true, date: true, amount: true, counterpartyRut: true, counterpartyName: true, externalRef: true, payments: { select: { id: true } } },
  });

  // clasificar cada registro y precomputar candidatos de movimiento
  type Plan = R & { projId: string; catId: string | null; catName: string; movId?: string; movRef?: string; reason?: string };
  const planAll: Plan[] = [];
  for (const r of recs) {
    const n = r.cc.match(/^(\d+)_/)![1];
    const proj = projByNum.get(n)!;
    // excluir traspasos entre cuentas (no es costo)
    if (/traspaso/i.test(r.cat)) { planAll.push({ ...r, projId: proj.id, catId: null, catName: "(traspaso — excluido)", reason: "TRASPASO" }); continue; }
    // ¿ya existe?
    const exists = invs.some((i) => i.projectId === proj.id && ((i.tipoDoc === 1043 && String(i.folioNumber).trim() === r.folio && normRut(i.rutIssuer || "") === normRut(r.rut)) || ((i.origin === "sin_respaldo" || i.origin === "maxxa_sin_respaldo") && normRut(i.rutIssuer || "") === normRut(r.rut) && Math.abs(i.totalAmount - r.monto) < 1)));
    if (exists) { planAll.push({ ...r, projId: proj.id, catId: null, catName: "", reason: "YA EXISTE" }); continue; }
    const cr = resolveCat(r.cat, r.sub);
    planAll.push({ ...r, projId: proj.id, catId: cr?.id ?? null, catName: cr?.name ?? "(sin map)" });
  }

  // asignación de movimientos sin colisión (greedy por cercanía de fecha)
  const candidatos = planAll.filter((p) => !p.reason); // los que se traerían
  const movUsed = new Set<string>();
  const movHasPayment = new Set(movs.filter((m) => m.payments.length > 0).map((m) => m.id));
  // para cada candidato, su lista de movs libres ordenada por cercanía
  const withCands = candidatos.map((p) => {
    const body = rutBody(p.rut);
    const c = movs.filter((m) => Math.abs(Math.round(m.amount)) === Math.round(p.monto) && body && normRut(m.counterpartyRut || "").replace(/-/g, "").includes(body) && days(m.date, p.fecha) <= 7 && !movHasPayment.has(m.id)).sort((a, b) => days(a.date, p.fecha) - days(b.date, p.fecha));
    return { p, c, best: c.length ? days(c[0].date, p.fecha) : Infinity };
  }).sort((a, b) => a.best - b.best);
  for (const { p, c } of withCands) {
    const m = c.find((x) => !movUsed.has(x.id));
    if (m) { movUsed.add(m.id); p.movId = m.id; p.movRef = m.externalRef || m.id; }
    else p.reason = "SIN MOV (Fase B)";
  }

  // ── snapshot gastado por obra ──
  async function gastado(pid: string): Promise<number> {
    const rec = await prisma.invoice.findMany({ where: { projectId: pid, type: "recibida" }, select: { tipoDoc: true, totalAmount: true } });
    return rec.reduce((s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount, 0);
  }

  // ── imprimir / aplicar por obra ──
  let totalCreate = 0, totalMoney = 0;
  for (const n of OBRAS) {
    const proj = projByNum.get(n)!;
    const items = planAll.filter((p) => p.projId === proj.id);
    const toCreate = items.filter((p) => !p.reason && p.movId);
    const before = await gastado(proj.id);
    console.log(`\n══ n°${n} ${proj.name} — gastado actual ${fmt(before)} ══`);
    for (const p of items.sort((a, b) => b.monto - a.monto)) {
      const tag = p.reason ? p.reason.padEnd(15) : "CREAR".padEnd(15);
      const extra = p.movId ? `→ mov ${p.movRef} [${p.catName}]` : (p.reason === "SIN MOV (Fase B)" ? "sin transferencia" : "");
      console.log(`  [${tag}] F-${p.folio.padEnd(4)} ${fmt(p.monto).padStart(11)} ${p.fecha} ${p.nom.slice(0, 26).padEnd(26)} ${extra}`);
    }
    const sum = toCreate.reduce((s, p) => s + p.monto, 0);
    console.log(`  → se crearían ${toCreate.length} · Σ ${fmt(sum)} · gastado quedaría ${fmt(before + sum)}`);
    totalCreate += toCreate.length; totalMoney += sum;

    // aplicar
    if (APPLY && (!OBRA_ARG || OBRA_ARG === n)) {
      const sinCat = toCreate.filter((p) => !p.catId);
      if (sinCat.length) { console.log(`  ⚠ ${sinCat.length} sin categoría mapeada — no aplico esta obra hasta resolver: ${sinCat.map((p) => "F-" + p.folio).join(", ")}`); continue; }
      console.log(`  APLICANDO n°${n} (secuencial)...`);
      let done = 0;
      for (const p of toCreate) {
        const dup = await prisma.invoicePayment.count({ where: { bankMovementId: p.movId } });
        if (dup > 0) { console.log(`    (ya hecho) F-${p.folio}`); continue; }
        const inv = await prisma.invoice.create({
          data: {
            projectId: p.projId, categoryId: p.catId!, type: "recibida", tipoDoc: 1043,
            folioNumber: p.folio, rutIssuer: normRut(p.rut), rutReceiver: BLARQ_RUT, businessName: p.nom,
            issueDate: new Date(p.fecha), dueDate: new Date(p.fecha), netAmount: p.monto, iva: 0, totalAmount: p.monto,
            status: "pagada", paidAt: new Date(p.fecha), origin: "maxxa_sin_respaldo",
            notes: `Pago sin documento tributario (${p.catName}). Migrado de Maxxa 2025 (folio ${p.folio}, ${p.cc}), conciliado contra la transferencia real.`,
          },
        });
        await prisma.invoicePayment.create({ data: { bankMovementId: p.movId!, invoiceId: inv.id, amountApplied: p.monto, autoMatched: false } });
        await prisma.bankMovement.update({ where: { id: p.movId! }, data: { status: "conciliado", category: null } });
        done++;
      }
      const after = await gastado(proj.id);
      const orphans = await prisma.invoice.findMany({ where: { projectId: proj.id, origin: "maxxa_sin_respaldo", payments: { none: {} } }, select: { folioNumber: true } });
      console.log(`  LISTO n°${n}: ${done} creados | gastado ${fmt(before)} → ${fmt(after)} (Δ ${fmt(after - before)}, esperado +${fmt(sum)})${orphans.length ? ` | ⚠ HUÉRFANOS ${orphans.length}` : ""}`);
    }
  }

  console.log(`\n══════ TOTAL Fase A: ${totalCreate} a crear · ${fmt(totalMoney)} ══════`);
  if (!APPLY) console.log("(DRY-RUN — nada escrito. --apply para escribir, --obra=NN para una sola)");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
