// PREMISA MJ (Maxxa manda): engancha los movimientos que la app tenía "sin
// factura" a la factura que MJ les asignó a mano en Maxxa. Solo los SEGUROS:
// donde el movimiento existe como sin_factura, calza monto+fecha, y su glosa/RUT
// CONFIRMA al proveedor de la factura de Maxxa (compra con tarjeta del proveedor
// o transferencia a su reembolsador). Los que no confirman quedan para revisión.
//
// Es ADITIVO: el movimiento no tenía factura → solo se le agrega la de Maxxa.
// No mueve ni pisa conciliaciones existentes. No cambia el gasto de las obras
// (sale de las facturas, no de los pagos). autoMatched=false (manual de MJ).
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/enganchar-sinfactura-maxxa.ts [--apply]

import "dotenv/config";
import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 52, 56].includes(parseInt(td, 10));
const normTxt = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const within = (a: string, b: string, days: number) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 <= days;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/ep-shy-morning/.test(url)) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }
  console.log(`enganchar-sinfactura-maxxa — ${APPLY ? "APPLY" : "DRY-RUN"} | prod\n`);

  const invs = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, payments: { select: { amountApplied: true } } } });
  const facByKey = new Map<string, any>();
  for (const inv of invs) { const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`; if (k !== "|") facByKey.set(k, inv); }
  const linkedSum = new Map<string, number>();
  for (const inv of invs) linkedSum.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));

  const movs = await prisma.bankMovement.findMany({ where: { bankAccountId: "ba_op_blarq", status: "sin_factura" },
    select: { id: true, date: true, amount: true, description: true, counterpartyRut: true } });
  const movApplied = new Map<string, number>(); // ya imputado en este run

  const reembs = await prisma.reembolsador.findMany({ select: { glosa: true, personRut: true, aliases: { select: { rut: true } } } });
  function proveedorConfirmado(mov: { description: string; counterpartyRut: string | null }, invRut: string | null, invName: string | null): boolean {
    const ir = rut8(invRut), mr = rut8(mov.counterpartyRut);
    if (ir && mr && (mr.includes(ir) || ir.includes(mr))) return true;
    for (const r of reembs) {
      const pr = (r.personRut ?? "").replace(/\D/g, "");
      const byRut = pr && mr && (pr.includes(mr) || mr.includes(pr));
      const byGlosa = r.glosa && normTxt(mov.description).includes(String(r.glosa).toLowerCase());
      if (byRut || byGlosa) if (r.aliases.some((a) => { const ad = rut8(a.rut); return ad && ir && (ad.includes(ir) || ir.includes(ad)); })) return true;
    }
    if (!mr && invName) { const tok = normTxt(invName).split(/\s+/).filter((w) => w.length >= 4)[0]; if (tok && normTxt(mov.description).includes(tok)) return true; }
    return false;
  }

  // 3 cartolas Maxxa, dedup id_pago
  const maxxaFiles = [
    "/Users/mjblanco/Downloads/MovimientosCartola_20260601_1722.xlsx",
    "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
    "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
  ];
  type Mx = { date: string; monto: number; asigns: { key: string; abono: number }[] };
  const rows: Mx[] = [];
  const seen = new Set<string>();
  for (const f of maxxaFiles) {
    const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (r[4] === "" || !r[27]) continue;
      let arr: any[] = []; try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { continue; }
      const asigns: { key: string; abono: number }[] = [];
      for (const a of arr) {
        const idp = String(a.id_pago ?? "");
        if (idp && seen.has(idp)) continue; if (idp) seen.add(idp);
        if (!isRealDte(String(a.TipoDoc))) continue;
        asigns.push({ key: `${String(a.Folio ?? "").replace(/^0+/, "")}|${rut8(a.Rut)}`, abono: Math.abs(Number(a.Abono) || 0) });
      }
      if (asigns.length) rows.push({ date: String(r[7]).slice(0, 10), monto: Math.abs(Number(r[4]) || 0), asigns });
    }
  }

  type Link = { movId: string; invId: string; amount: number; folio: string; prov: string; desc: string };
  const plan: Link[] = [];          // compra con tarjeta directa → se aplica
  const reembolso: Link[] = [];     // transferencia a persona vía reembolsador → solo se lista (confirmar)
  const plannedPerInv = new Map<string, number>();
  for (const row of rows) {
    const cands = movs.filter((m) => Math.abs(Math.abs(m.amount) - row.monto) <= 2 && within(m.date.toISOString(), row.date, 5));
    for (const a of row.asigns) {
      const inv = facByKey.get(a.key);
      if (!inv) continue;
      const saldo = inv.totalAmount - (linkedSum.get(inv.id) ?? 0) - (plannedPerInv.get(inv.id) ?? 0);
      if (saldo <= 1) continue;
      const usable = cands.filter((m) => (Math.abs(m.amount) - (movApplied.get(m.id) ?? 0)) >= a.abono - 2);
      if (usable.length !== 1) continue;              // 0 o ambiguo → no
      const m = usable[0];
      if (!proveedorConfirmado(m, inv.rutIssuer, inv.businessName)) continue; // SOLO enganchables
      const amount = Math.min(a.abono, saldo);
      if (amount <= 1) continue;
      // ¿compra con tarjeta DIRECTA (sin RUF, glosa nombra al proveedor)? → seguro
      const tok = normTxt(inv.businessName).split(/\s+/).filter((w: string) => w.length >= 4)[0];
      const compraDirecta = !rut8(m.counterpartyRut) && tok && normTxt(m.description).includes(tok);
      const link: Link = { movId: m.id, invId: inv.id, amount, folio: a.key.split("|")[0], prov: inv.businessName ?? "", desc: m.description.slice(0, 30) };
      (compraDirecta ? plan : reembolso).push(link);
      movApplied.set(m.id, (movApplied.get(m.id) ?? 0) + amount);
      plannedPerInv.set(inv.id, (plannedPerInv.get(inv.id) ?? 0) + amount);
    }
  }

  const facturas = new Set(plan.map((p) => p.invId));
  const movsTocados = new Set(plan.map((p) => p.movId));
  console.log(`PLAN A APLICAR — compras con tarjeta directas (seguro): ${plan.length} pagos → ${facturas.size} facturas, ${fmt(plan.reduce((s, p) => s + p.amount, 0))}\n`);
  for (const p of plan.slice(0, 50)) console.log(`   ${fmt(p.amount).padStart(11)}  folio ${p.folio.padEnd(11)} ${p.prov.slice(0, 28)}  ← "${p.desc}"`);
  if (plan.length > 50) console.log(`   … y ${plan.length - 50} más`);
  console.log(`\nNO se aplican — transferencias a persona vía reembolsador (CONFIRMAR con MJ): ${reembolso.length} · ${fmt(reembolso.reduce((s, p) => s + p.amount, 0))}`);
  for (const p of reembolso) console.log(`   ${fmt(p.amount).padStart(11)}  folio ${p.folio.padEnd(11)} ${p.prov.slice(0, 28)}  ← "${p.desc}"`);

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  const gastoAntes = invs.filter((i) => true).reduce((s, i) => s + i.totalAmount, 0); // referencia (no cambia)
  let creados = 0;
  for (const p of plan) {
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.movId, invoiceId: p.invId } });
    if (!exists) { await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: p.invId, amountApplied: p.amount, autoMatched: false } }); creados++; }
  }
  // estado de cada mov tocado: conciliado si quedó usado completo, si no parcial
  for (const movId of movsTocados) {
    const m = movs.find((x) => x.id === movId)!;
    const applied = movApplied.get(movId) ?? 0;
    await prisma.bankMovement.update({ where: { id: movId }, data: { status: applied >= Math.abs(m.amount) - 1 ? "conciliado" : "parcial" } });
  }
  for (const invId of facturas) await recomputeInvoiceStatus(invId);
  console.log(`\nEscrito: ${creados} pagos, ${movsTocados.size} movimientos actualizados.`);

  const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
  const gasto = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`Gasto recibidas no-anuladas (no debe cambiar por enganchar pagos): ${fmt(gasto)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
