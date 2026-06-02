// Arregla los movimientos SOBRE-IMPUTADOS (un bankMovement contado como pago de
// más facturas que su monto) dejándolos EXACTAMENTE como dice la cartola de Maxxa.
//
// Causa: el cruce por glosa (cruce-glosa-maxxa.ts, basado en el export) no controla
// capacidad del movimiento → enganchó un mismo mov a 2 facturas del mismo proveedor/
// monto. La CARTOLA (columna Asignacion) dice a qué folio va realmente cada mov.
//
// Para cada mov Operativa con sum(pagos) > |monto|+1:
//   - busca en la cartola su asignación (por fecha+monto) → folio(s) correcto(s);
//   - borra los pagos a folios que NO están en la cartola;
//   - agrega el pago al folio de la cartola si falta (capeado al saldo y al monto);
//   - recalcula las facturas tocadas.
//   - si el mov NO está en la cartola → NO toca, lo deja para revisión manual.
//
// CANDADOS: solo prod · cartola = verdad · no sobre-imputa · gasto Δ$0 · idempotente.
// Dry-run por default. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/fix-sobreimputados-cartola.ts [--apply]

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // cartola: índice de asignación por (fecha|monto) → [{folio,rut,abono}]
  const maxxaFiles = [
    join(homedir(), "Downloads", "MovimientosCartola_20260601_1722.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2355.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2356.xlsx"),
  ];
  const cartByDateAmt = new Map<string, { folio: string; rut: string; abono: number }[]>();
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
      const date = String(r[7]).slice(0, 10);
      const amount = Math.abs(Number(r[4]) || 0);
      const k = `${date}|${amount}`;
      if (arr.length) cartByDateAmt.set(k, arr.map((a) => ({ folio: String(a.Folio ?? "").replace(/^0+/, ""), rut: rut8(a.Rut), abono: Math.abs(Number(a.Abono) || 0) })));
    }
  }

  // facturas (folio+rut → factura) y movs sobre-imputados
  const invs = await prisma.invoice.findMany({ where: { type: "recibida" },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, payments: { select: { id: true, amountApplied: true } } } });
  const facByKey = new Map<string, any>();
  for (const inv of invs) facByKey.set(`${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`, inv);
  const invById = new Map(invs.map((i) => [i.id, i]));
  const appliedOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);

  const movs = await prisma.bankMovement.findMany({ where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, payments: { select: { id: true, invoiceId: true, amountApplied: true } } } });

  const gasto = (list: any[]) => list.filter((i) => i.status !== "anulada" && (i as any).tipoDoc !== 61);
  // gasto canónico vía query aparte (excluye NC)
  const gAntesRows = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 }, status: { not: "anulada" } }, select: { totalAmount: true } });
  const gastoAntes = gAntesRows.reduce((s, i) => s + i.totalAmount, 0);

  type Del = { payId: string; folio: string; invId: string };
  type Add = { invId: string; folio: string; amount: number };
  const plan: { mov: string; date: string; amount: number; desc: string; dels: Del[]; adds: Add[]; note: string }[] = [];

  for (const m of movs) {
    const applied = m.payments.reduce((s, p) => s + p.amountApplied, 0);
    if (applied <= Math.abs(m.amount) + 1) continue; // no sobre-imputado
    const date = m.date.toISOString().slice(0, 10);
    const cart = cartByDateAmt.get(`${date}|${Math.abs(m.amount)}`);
    if (!cart || !cart.length) { plan.push({ mov: m.id, date, amount: Math.abs(m.amount), desc: m.description ?? "", dels: [], adds: [], note: "NO está en la cartola → revisar a mano (no se toca)" }); continue; }
    // folios correctos según cartola
    const wantFolios = new Set(cart.map((c) => `${c.folio}|${c.rut}`));
    const wantInvIds = new Set<string>();
    for (const c of cart) { const inv = facByKey.get(`${c.folio}|${c.rut}`); if (inv) wantInvIds.add(inv.id); }
    // borrar pagos a facturas que NO están en la cartola
    const dels: Del[] = [];
    for (const p of m.payments) { if (!wantInvIds.has(p.invoiceId)) { const iv = invById.get(p.invoiceId); dels.push({ payId: p.id, folio: iv ? String(iv.folioNumber).replace(/^0+/, "") : "?", invId: p.invoiceId }); } }
    // agregar pago a la factura de la cartola si falta
    const haveInvIds = new Set(m.payments.map((p) => p.invoiceId));
    const adds: Add[] = [];
    let capLeft = Math.abs(m.amount) - m.payments.filter((p) => wantInvIds.has(p.invoiceId)).reduce((s, p) => s + p.amountApplied, 0);
    for (const c of cart) {
      const inv = facByKey.get(`${c.folio}|${c.rut}`);
      if (!inv || haveInvIds.has(inv.id)) continue;
      const saldo = inv.totalAmount - appliedOf(inv);
      const amt = Math.min(c.abono || saldo, saldo, capLeft);
      if (amt > 1) { adds.push({ invId: inv.id, folio: c.folio, amount: amt }); capLeft -= amt; }
    }
    plan.push({ mov: m.id, date, amount: Math.abs(m.amount), desc: m.description ?? "", dels, adds, note: `cartola → ${[...wantFolios].map((x) => "f" + x.split("|")[0]).join(",")}` });
  }

  // reporte
  console.log(`Movimientos sobre-imputados encontrados: ${plan.length}\n`);
  for (const p of plan) {
    console.log(`${p.date} ${fmt(p.amount)} "${p.desc.slice(0, 32)}"  [${p.note}]`);
    for (const d of p.dels) console.log(`    BORRAR pago a f${d.folio}`);
    for (const a of p.adds) console.log(`    AGREGAR pago a f${a.folio} ${fmt(a.amount)}`);
  }

  if (!APPLY) { console.log(`\n[DRY-RUN] No se escribió nada. Gasto: ${fmt(gastoAntes)}. --apply para aplicar.`); await prisma.$disconnect(); return; }

  const recompute = new Set<string>();
  let del = 0, add = 0;
  for (const p of plan) {
    for (const d of p.dels) { await prisma.invoicePayment.delete({ where: { id: d.payId } }); recompute.add(d.invId); del++; }
    for (const a of p.adds) { await prisma.invoicePayment.create({ data: { bankMovementId: p.mov, invoiceId: a.invId, amountApplied: a.amount, autoMatched: false } }); recompute.add(a.invId); add++; }
    // estado del mov
    if (p.dels.length || p.adds.length) {
      const fresh = await prisma.invoicePayment.findMany({ where: { bankMovementId: p.mov }, select: { amountApplied: true } });
      const used = fresh.reduce((s, x) => s + x.amountApplied, 0);
      await prisma.bankMovement.update({ where: { id: p.mov }, data: { status: used >= p.amount - 1 ? "conciliado" : used > 0 ? "parcial" : "sin_asignar" } });
    }
  }
  for (const id of recompute) await recomputeInvoiceStatus(id);

  const gPost = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 }, status: { not: "anulada" } }, select: { totalAmount: true } });
  const gastoPost = gPost.reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nAPLICADO: ${del} pagos borrados, ${add} agregados, ${recompute.size} facturas recalculadas.`);
  console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (Δ ${fmt(gastoPost - gastoAntes)}; debe ser $0).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
