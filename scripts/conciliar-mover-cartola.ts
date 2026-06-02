// PUNTO 1 ronda 42 (resto) — los 10 MOVER del cruce por glosa.
//
// MOVER = la app enganchó un movimiento a una factura EQUIVOCADA (por monto), pero
// la cartola (asignación manual de MJ = la verdad) dice que ese mov paga OTRA factura.
// Para cada uno: se despega de la(s) factura(s) equivocada(s) y se engancha a la que
// dice la cartola. La factura vieja vuelve a pendiente (nunca la pagó ese mov).
//
// La verdad sale de la CARTOLA: para cada mov (monto+glosa) se lee a qué folio+rut
// lo asignó MJ. Solo se mueve si:
//   - la cartola lo asigna a una factura que SÍ está en la app (folio+rut), y
//   - el mov hoy NO está ya en esa factura destino (idempotente).
//
// CANDADOS: solo prod (ep-shy-morning) · no sobre-imputa la destino (cap al saldo) ·
// idempotente · verifica que el gasto recibidas no-anuladas NO cambie.
// Dry-run por default. Escribe con --apply.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-mover-cartola.ts [--apply]

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// los 10 MOVER (monto + palabra de glosa para ubicar el mov en app y cartola)
const MOVERS = [
  { label: "Paula Johanna f1692", amount: 119000, glosaKey: "elias arias" },
  { label: "Sherwin f2708162", amount: 105791, glosaKey: "sherwin" },
  { label: "AKI KB f230174 (doble-broche)", amount: 105690, glosaKey: "akikb" },
  { label: "WorldQuery f67494 (BOOZ.CL)", amount: 43910, glosaKey: "booz" },
  { label: "Aceros Moroni f76562", amount: 38556, glosaKey: "aceros mor" },
  { label: "Lazos Meltsakou f62860", amount: 25900, glosaKey: "libreria toa" },
  { label: "Sherwin f2757977", amount: 20970, glosaKey: "sherwin" },
  { label: "Ferreteria Cavem f140707", amount: 16790, glosaKey: "ferreteria cavem" },
  { label: "Easy f36902994", amount: 15670, glosaKey: "easy alto las con" },
  { label: "Sucesion Juan f5198", amount: 6200, glosaKey: "ferreteria las carreta" },
];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // cartola Maxxa (dedup id_pago)
  const maxxaFiles = [
    join(homedir(), "Downloads", "MovimientosCartola_20260601_1722.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2355.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2356.xlsx"),
  ];
  type CRow = { date: string; amount: number; desc: string; asigns: any[]; idp: string };
  const crows: CRow[] = [];
  const seen = new Set<string>();
  for (const f of maxxaFiles) {
    const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (r[4] === "") continue;
      let arr: any[] = [];
      if (r[27]) { try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { arr = []; } }
      const idp = arr[0]?.id_pago ? String(arr[0].id_pago) : `row-${r[3]}-${r[4]}-${r[7]}`;
      if (seen.has(idp)) continue;
      seen.add(idp);
      crows.push({ date: String(r[7]).slice(0, 10), amount: Math.abs(Number(r[4]) || 0), desc: String(r[3] ?? ""), asigns: arr, idp });
    }
  }

  const invs = await prisma.invoice.findMany({ where: { type: "recibida" },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, tipoDoc: true, projectId: true, payments: { select: { id: true, amountApplied: true } } } });
  // gasto canónico = recibidas no-anuladas EXCLUYENDO notas de crédito (tipoDoc 61)
  const gasto = (list: any[]) => list.filter((i) => i.status !== "anulada" && i.tipoDoc !== 61).reduce((s, i) => s + i.totalAmount, 0);
  const invById = new Map(invs.map((i) => [i.id, i]));
  const facByKey = new Map<string, any>();
  for (const inv of invs) { const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`; facByKey.set(k, inv); }
  const appliedByInv = new Map<string, number>();
  for (const inv of invs) appliedByInv.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));
  const projName = new Map<string, string>((await prisma.project.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name ?? p.id]));
  const movsRaw = await prisma.bankMovement.findMany({ where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { id: true, invoiceId: true, amountApplied: true } } } });
  const movs = movsRaw.map((m) => ({ ...m, dateStr: m.date.toISOString().slice(0, 10) }));

  type Plan = { label: string; movId: string; movDate: string; targetInvId: string; targetFolio: string; amount: number; detachInvIds: string[]; colgando: string[] };
  const plan: Plan[] = [];
  const warnings: string[] = [];

  for (const t of MOVERS) {
    const cm = crows.filter((r) => r.amount === t.amount && norm(r.desc).includes(t.glosaKey.split(" ")[0]));
    // asignación de la cartola → folio+rut destino
    let target: any = null;
    for (const m of cm) for (const a of m.asigns) {
      const folio = String(a.Folio ?? "").replace(/^0+/, ""); const rut = rut8(a.Rut);
      const inv = facByKey.get(`${folio}|${rut}`);
      if (inv) { target = inv; break; }
    }
    if (!target) { warnings.push(`${t.label}: la cartola no asigna a una factura que esté en la app`); continue; }

    // el mov en la app (monto+glosa). Si hay varios, tomar el que tenga pagos a una factura distinta de la destino
    const am = movs.filter((x) => Math.abs(Math.abs(x.amount) - t.amount) <= 2 && norm(x.description).includes(t.glosaKey.split(" ")[0]));
    if (!am.length) { warnings.push(`${t.label}: no encuentro el mov en la app`); continue; }
    // preferimos el mov que está pegado a una factura != destino (el que hay que mover)
    const mv = am.find((x) => x.payments.some((p) => p.invoiceId !== target.id)) ?? am[0];

    const linkedInvIds = [...new Set(mv.payments.map((p) => p.invoiceId))];
    if (linkedInvIds.length === 1 && linkedInvIds[0] === target.id) { warnings.push(`${t.label}: el mov YA está en la factura destino (nada que mover)`); continue; }
    const detach = linkedInvIds.filter((id) => id !== target.id);

    const saldo = target.totalAmount - (appliedByInv.get(target.id) ?? 0);
    if (saldo <= 1) { warnings.push(`${t.label}: la factura destino f${target.folioNumber} ya está pagada (saldo ${fmt(saldo)}) — revisar a mano`); continue; }
    const amount = Math.min(Math.abs(mv.amount), saldo);

    // ¿qué facturas viejas quedan colgando? (las que pierden su único pago)
    const colgando = detach.map((id) => {
      const iv = invById.get(id)!;
      return iv.payments.length <= 1 ? `f${String(iv.folioNumber).replace(/^0+/, "")} ${(iv.businessName ?? "").slice(0, 16)} → pendiente` : `f${String(iv.folioNumber).replace(/^0+/, "")} (quedan ${iv.payments.length - 1} pagos)`;
    });

    plan.push({ label: t.label, movId: mv.id, movDate: mv.dateStr, targetInvId: target.id, targetFolio: String(target.folioNumber).replace(/^0+/, ""), amount, detachInvIds: detach, colgando });
  }

  // reporte
  console.log(`\n${"=".repeat(80)}\nPLAN MOVER — corregir movs pegados a factura equivocada (${plan.length})\n${"=".repeat(80)}`);
  let total = 0;
  for (const p of plan) {
    const tgt = invById.get(p.targetInvId)!;
    const detachStr = p.detachInvIds.map((id) => { const iv = invById.get(id)!; return `f${String(iv.folioNumber).replace(/^0+/, "")} ${(iv.businessName ?? "").slice(0, 16)}`; }).join(" + ");
    console.log(`  ${p.label}`);
    console.log(`     mov ${p.movDate} ${fmt(p.amount)}:  despegar de [${detachStr}]  →  enganchar a f${p.targetFolio} ${(tgt.businessName ?? "").slice(0, 20)} obra:${tgt.projectId ? projName.get(tgt.projectId) : "-"}`);
    console.log(`     colgando: ${p.colgando.join(" · ")}`);
    total += p.amount;
  }
  console.log(`  ${"-".repeat(74)}\n  TOTAL movido: ${fmt(total)} en ${plan.length} casos`);
  if (warnings.length) { console.log(`\n  AVISOS (no se actuó):`); for (const w of warnings) console.log(`    - ${w}`); }

  const gastoAntes = gasto(invs);
  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Gasto recibidas no-anuladas: ${fmt(gastoAntes)}. Corré con --apply.`);
    await prisma.$disconnect();
    return;
  }

  // aplicar
  const recompute = new Set<string>();
  let moved = 0;
  for (const p of plan) {
    // despegar de las viejas
    await prisma.invoicePayment.deleteMany({ where: { bankMovementId: p.movId, invoiceId: { in: p.detachInvIds } } });
    p.detachInvIds.forEach((id) => recompute.add(id));
    // enganchar a la destino (idempotente)
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.movId, invoiceId: p.targetInvId } });
    if (!exists) await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: p.targetInvId, amountApplied: p.amount, autoMatched: false } });
    recompute.add(p.targetInvId);
    // estado del mov: conciliado si cubre su monto
    const mv = movs.find((x) => x.id === p.movId)!;
    await prisma.bankMovement.update({ where: { id: p.movId }, data: { status: p.amount >= Math.abs(mv.amount) - 1 ? "conciliado" : "parcial" } });
    moved++;
  }
  for (const id of recompute) await recomputeInvoiceStatus(id);

  const post = await prisma.invoice.findMany({ where: { type: "recibida" }, select: { status: true, totalAmount: true, tipoDoc: true } });
  const gastoPost = gasto(post);
  console.log(`\nAPLICADO: ${moved} movidos, ${recompute.size} facturas recalculadas.`);
  console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (Δ ${fmt(gastoPost - gastoAntes)}; debe ser $0).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
