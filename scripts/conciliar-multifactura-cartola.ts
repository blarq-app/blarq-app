// PUNTO 2 (frente A) ronda 42 — re-emparejar los movimientos que SÍ están en la
// app pero pagan VARIAS facturas a la vez (el cruce por glosa no los emparejó
// porque el monto parcial por factura no calza con el monto del movimiento).
//
// Fuente de verdad: la cartola Maxxa. Cada movimiento trae en la columna
// Asignacion el REPARTO manual de MJ: qué folios paga y con cuánto (Abono).
// Para cada movimiento de la cartola que exista en la app (por monto+fecha):
//   - se ubica el bankMovement en la app (único por monto±2 + fecha±1d),
//   - por cada folio+rut del reparto que apunte a una factura de la app con saldo,
//     se crea el InvoicePayment con el Abono de Maxxa (capeado).
//
// CANDADOS: solo prod (ep-shy-morning) · el app-mov debe ser ÚNICO por monto+fecha
// (si hay varios → se salta, ambiguo) · no sobre-imputa la factura (cap al saldo) ·
// no sobre-imputa el movimiento (cap a la capacidad libre = |monto| − pagos previos) ·
// idempotente (salta si el pago ya existe) · solo facturas recibidas (no ventas, no NC) ·
// verifica que el gasto recibidas no-anuladas NO cambie.
// Dry-run por default. Escribe con --apply.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-multifactura-cartola.ts [--apply]

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
const core = (s: any) => norm(s).replace(/^\d+\s*/, "").replace(/\s+/g, " ").trim();
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
// "comercio": saca prefijos de banco (compra nacional / transf a / merpago* / etc.)
// y deja los tokens del nombre del proveedor, para comparar app-mov vs cartola.
const merchant = (s: any) => norm(s)
  .replace(/^\d+\s*/, "")
  .replace(/^(compra nacional np|compra nacional|compra internacional|compra|transf\.internet a|transf a|pago a|merpago\*|mercpago\*|toku \*|np )\s*/i, "")
  .replace(/[*.,]/g, " ").replace(/\s+/g, " ").trim();
const merchantOk = (a: string, b: string) => {
  const ta = merchant(a).split(" ").filter((w) => w.length >= 4);
  const tb = merchant(b).split(" ").filter((w) => w.length >= 4);
  return ta.some((x) => tb.some((y) => x.startsWith(y) || y.startsWith(x)));
};

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── app ──
  const invs = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, projectId: true, payments: { select: { amountApplied: true } } } });
  const facByKey = new Map<string, any>();
  for (const inv of invs) { const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`; if (k !== "|") facByKey.set(k, inv); }
  const appliedByInv = new Map<string, number>();
  for (const inv of invs) appliedByInv.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));
  const projName = new Map<string, string>((await prisma.project.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name ?? p.id]));
  const movsRaw = await prisma.bankMovement.findMany({ where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { amountApplied: true, invoiceId: true } } } });
  const movs = movsRaw.map((m) => ({ ...m, dateStr: m.date.toISOString().slice(0, 10), appliedPrev: m.payments.reduce((s, p) => s + p.amountApplied, 0) }));
  // pares (mov, factura) que YA tienen pago → no re-listar en el plan (evita fantasmas)
  const existingPair = new Set<string>();
  for (const m of movsRaw) for (const p of m.payments) existingPair.add(`${m.id}|${p.invoiceId}`);

  // ── cartola Operativa (dedup id_pago) ──
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

  // ── plan ──
  type Pay = { invId: string; folio: string; prov: string; obra: string; abono: number; apply: number };
  type MovPlan = { idp: string; date: string; amount: number; desc: string; appMovId: string; capacity: number; pays: Pay[] };
  const plans: MovPlan[] = [];
  const warnings: string[] = [];
  // capacidad libre por app-mov, COMPARTIDA entre filas de la cartola dentro de
  // esta corrida (si 2 id_pago distintos mapean al mismo app-mov, no se duplica).
  const movCapLeft = new Map<string, number>();
  for (const m of movs) movCapLeft.set(m.id, Math.abs(m.amount) - m.appliedPrev);

  for (const c of crows) {
    if (!c.asigns.length) continue;
    // ¿el reparto toca alguna factura recibida de la app con saldo? si no, no hay nada que hacer
    const targets = c.asigns
      .map((a) => ({ a, inv: facByKey.get(`${String(a.Folio ?? "").replace(/^0+/, "")}|${rut8(a.Rut)}`) }))
      .filter((t) => t.inv && (t.inv.totalAmount - (appliedByInv.get(t.inv.id) ?? 0)) > 1);
    if (!targets.length) continue;
    // solo nos interesa cuando es multi-factura (1 sola factura ya la cubre el cruce/AMBIGUO/MOVER)
    // pero igual lo procesamos si quedó suelto; el filtro real es que el cruce no lo tomó.

    // ubicar el app-mov ÚNICO por monto+fecha (±1d). Desempatar por glosa si hay varios.
    let cand = movs.filter((x) => Math.abs(Math.abs(x.amount) - c.amount) <= 2 && dayDiff(x.dateStr, c.date) <= 1);
    if (cand.length > 1) {
      const g = core(c.desc);
      const byGlosa = cand.filter((x) => { const cg = core(x.description); return cg.startsWith(g.slice(0, 12)) || g.startsWith(cg.slice(0, 12)); });
      if (byGlosa.length === 1) cand = byGlosa;
    }
    if (cand.length !== 1) {
      warnings.push(`${c.date} ${fmt(c.amount)} "${c.desc.slice(0, 28)}": ${cand.length === 0 ? "no está en la app" : cand.length + " app-movs calzan (ambiguo)"} → ${targets.map((t) => "f" + t.inv.folioNumber).join(",")}`);
      continue;
    }
    const mv = cand[0];
    // candado anti-casualidad: aunque calce monto+fecha, la glosa del app-mov debe
    // concordar con la de la cartola (mismo proveedor) — evita pegar a un mov de otro
    // proveedor del mismo monto el mismo día.
    if (!merchantOk(c.desc, mv.description)) {
      warnings.push(`${c.date} ${fmt(c.amount)} "${c.desc.slice(0, 28)}": app-mov calza monto+fecha pero el comercio NO concuerda ("${mv.description.slice(0, 24)}") → salto por seguridad`);
      continue;
    }
    let capacity = movCapLeft.get(mv.id) ?? 0; // capacidad libre COMPARTIDA en la corrida
    if (capacity <= 1) {
      warnings.push(`${c.date} ${fmt(c.amount)} "${c.desc.slice(0, 28)}": el app-mov ya quedó sin capacidad (otra fila de cartola lo usó / la app no tiene un 2º mov igual) → ${targets.map((t) => "f" + t.inv.folioNumber).join(",")}`);
      continue;
    }

    const pays: Pay[] = [];
    for (const t of targets) {
      const inv = t.inv;
      if (existingPair.has(`${mv.id}|${inv.id}`)) continue; // ya hay pago de este mov a esta factura
      const saldo = inv.totalAmount - (appliedByInv.get(inv.id) ?? 0);
      if (saldo <= 1) continue;
      const abono = Math.abs(Number(t.a.Abono) || 0) || saldo;
      const apply = Math.min(abono, saldo, capacity);
      if (apply <= 1) continue;
      pays.push({ invId: inv.id, folio: String(inv.folioNumber).replace(/^0+/, ""), prov: inv.businessName ?? "", obra: inv.projectId ? (projName.get(inv.projectId) ?? "-") : "-", abono, apply });
      capacity -= apply;
      // reflejar en los acumulados locales para no re-aplicar dentro de la misma corrida
      appliedByInv.set(inv.id, (appliedByInv.get(inv.id) ?? 0) + apply);
      movCapLeft.set(mv.id, capacity);
    }
    if (pays.length) plans.push({ idp: c.idp, date: c.date, amount: c.amount, desc: c.desc, appMovId: mv.id, capacity, pays });
  }

  // ── reporte ──
  let totalPays = 0, totalAmt = 0;
  console.log(`\n${"=".repeat(82)}\nPLAN multi-factura (movs en la app, reparto de la cartola) — ${plans.length} movimientos\n${"=".repeat(82)}`);
  for (const p of plans.sort((a, b) => b.amount - a.amount)) {
    console.log(`\n  ${p.date}  ${fmt(p.amount)}  "${p.desc.slice(0, 40)}"  (libre tras aplicar: ${fmt(p.capacity)})`);
    for (const y of p.pays) { console.log(`       → f${y.folio.padEnd(10)} ${y.prov.slice(0, 22).padEnd(22)} obra:${y.obra.slice(0, 14).padEnd(14)} ${fmt(y.apply)}${y.apply < y.abono ? ` (capeado de ${fmt(y.abono)})` : ""}`); totalPays++; totalAmt += y.apply; }
  }
  console.log(`\n  ${"-".repeat(76)}\n  TOTAL: ${totalPays} pagos a facturas · ${fmt(totalAmt)} · desde ${plans.length} movimientos`);
  if (warnings.length) { console.log(`\n  AVISOS (no se actuó, ${warnings.length}):`); for (const w of warnings.slice(0, 40)) console.log(`    - ${w}`); if (warnings.length > 40) console.log(`    ... y ${warnings.length - 40} más`); }

  const gastoAntes = invs.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Gasto recibidas no-anuladas: ${fmt(gastoAntes)}. Corré con --apply.`);
    await prisma.$disconnect();
    return;
  }

  // ── aplicar ──
  const recompute = new Set<string>();
  let created = 0;
  for (const p of plans) {
    for (const y of p.pays) {
      const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.appMovId, invoiceId: y.invId } });
      if (!exists) { await prisma.invoicePayment.create({ data: { bankMovementId: p.appMovId, invoiceId: y.invId, amountApplied: y.apply, autoMatched: false } }); created++; }
      recompute.add(y.invId);
    }
    // estado del mov
    const used = p.pays.reduce((s, y) => s + y.apply, 0);
    const mv = movs.find((x) => x.id === p.appMovId)!;
    const totalUsed = mv.appliedPrev + used;
    await prisma.bankMovement.update({ where: { id: p.appMovId }, data: { status: totalUsed >= Math.abs(mv.amount) - 1 ? "conciliado" : "parcial" } });
  }
  for (const id of recompute) await recomputeInvoiceStatus(id);

  const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
  const gastoPost = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nAPLICADO: ${created} pagos creados, ${recompute.size} facturas recalculadas.`);
  console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (Δ ${fmt(gastoPost - gastoAntes)}; debe ser $0).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
