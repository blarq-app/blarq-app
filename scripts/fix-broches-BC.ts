// Grupos B+C — re-enganche del broche faltante: crea el InvoicePayment que
// vincula el movimiento del banco (sin_asignar) con la factura que pagó, según
// el mapa de Maxxa (cada mov de la cartola dice a qué folio+rut se imputó).
//
// CONSERVADOR (manual > mal hecho):
//  - Solo engancha si encuentra EXACTAMENTE UN movimiento sin_asignar en la
//    cuenta Operativa que calce el monto del abono Maxxa (±$2) y la fecha (±5d).
//    Si hay varios candidatos o ninguno → lo deja para revisión manual (skip).
//  - Nunca imputa más que el saldo restante de la factura (no sobre-imputa).
//  - Nunca reusa un movimiento más allá de su monto (capacidad).
//  - No baja estados; al enganchar recalcula (sube a parcial/pagada).
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/fix-broches-BC.ts [--apply]

import "dotenv/config";
import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);
const isRealDte = (td: string) => [33, 34, 39, 41, 43, 46, 48, 52, 56].includes(parseInt(td, 10));

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "—";
  const env = /ep-shy-morning/.test(process.env.DATABASE_URL ?? "") ? "prod" : "otro";
  console.log(`fix-broches-BC — ${APPLY ? "APPLY" : "DRY-RUN"} | ${env} | ${host}\n`);

  // ── app en vivo ──────────────────────────────────────────────────────────
  const invs = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true,
      payments: { select: { amountApplied: true } } },
  });
  const facByKey = new Map<string, any>();
  for (const inv of invs) {
    const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`;
    if (k !== "|") facByKey.set(k, inv);
  }
  const linkedSum = new Map<string, number>();
  for (const inv of invs) linkedSum.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));

  const movs = await prisma.bankMovement.findMany({
    where: { bankAccountId: "ba_op_blarq", status: "sin_asignar" },
    select: { id: true, date: true, amount: true, description: true, counterpartyRut: true },
  });
  // reembolsadores (para confirmar proveedor vía alias persona→empresa)
  const reembs = await prisma.reembolsador.findMany({ select: { glosa: true, personRut: true, aliases: { select: { rut: true } } } });
  const normTxt = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // ¿la glosa/rut del mov confirma que es ese proveedor (rutIssuer)?
  function proveedorConfirmado(mov: { description: string; counterpartyRut: string | null }, invRut: string | null, invName: string | null): boolean {
    const ir = rut8(invRut);
    const mr = rut8(mov.counterpartyRut);
    if (ir && mr && (mr.includes(ir) || ir.includes(mr))) return true; // RUT directo
    // alias de reembolsador: el mov es a una persona cuyo alias es el RUT de la factura
    for (const r of reembs) {
      const pr = (r.personRut ?? "").replace(/\D/g, "");
      const byRut = pr && mr && (pr.includes(mr) || mr.includes(pr));
      const byGlosa = r.glosa && normTxt(mov.description).includes(r.glosa.toLowerCase());
      if (byRut || byGlosa) {
        if (r.aliases.some((a) => { const ad = a.rut.replace(/\D/g, "").slice(-8); return ad && ir && (ad.includes(ir) || ir.includes(ad)); })) return true;
      }
    }
    // compra con tarjeta sin RUT: la glosa nombra al proveedor
    if (!mr && invName) {
      const tok = normTxt(invName).split(/\s+/).filter((w) => w.length >= 4)[0];
      if (tok && normTxt(mov.description).includes(tok)) return true;
    }
    return false;
  }
  // capacidad disponible por movimiento (para no reusar de más en el batch)
  const movCap = new Map<string, number>();
  for (const m of movs) movCap.set(m.id, Math.abs(m.amount));

  // ── Maxxa: filas (movimientos) con sus asignaciones, dedup por id_pago ─────
  const maxxaFiles = [
    "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2355.xlsx",
    "/Users/mjblanco/Downloads/2025_Maxxa/MovimientosCartola_20260530_2356.xlsx",
  ];
  type MxRow = { date: string; monto: number; desc: string; asigns: { key: string; abono: number; idPago: string }[] };
  const rows: MxRow[] = [];
  const seenIdPago = new Set<string>();
  for (const f of maxxaFiles) {
    const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (r[4] === "" || !r[27]) continue;
      let arr: any[] = [];
      try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { continue; }
      const asigns: { key: string; abono: number; idPago: string }[] = [];
      for (const a of arr) {
        const idPago = String(a.id_pago ?? "");
        if (idPago && seenIdPago.has(idPago)) continue;
        if (idPago) seenIdPago.add(idPago);
        if (!isRealDte(String(a.TipoDoc))) continue;
        asigns.push({ key: `${String(a.Folio ?? "").replace(/^0+/, "")}|${rut8(a.Rut)}`, abono: Math.abs(Number(a.Abono) || 0), idPago });
      }
      if (asigns.length) rows.push({ date: String(r[7]).slice(0, 10), monto: Math.abs(Number(r[4]) || 0), desc: String(r[3] ?? ""), asigns });
    }
  }

  // ── planificar ─────────────────────────────────────────────────────────
  const within = (a: string, b: string, days: number) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 <= days;
  type Link = { movId: string; invId: string; amount: number; folio: string; prov: string; movDate: string };
  const plan: Link[] = [];
  const usedMovInRun = new Map<string, number>(); // movId → usado en este plan
  const plannedPerInv = new Map<string, number>();
  const flags = { ambiguo: 0, noMov: 0, sinFactura: 0, yaCompleta: 0, noConfirma: 0 };
  const ejAmbiguo: string[] = [], ejNoMov: string[] = [], ejNoConfirma: string[] = [];

  for (const row of rows) {
    // movimiento app candidato: Operativa sin_asignar, |monto| igual, fecha ±5d
    const cands = movs.filter((m) => Math.abs(Math.abs(m.amount) - row.monto) <= 2 && within(m.date.toISOString(), row.date, 5));
    for (const a of row.asigns) {
      const inv = facByKey.get(a.key);
      if (!inv) { flags.sinFactura++; continue; }
      const totalLinked = (linkedSum.get(inv.id) ?? 0) + (plannedPerInv.get(inv.id) ?? 0);
      const saldo = inv.totalAmount - totalLinked;
      if (saldo <= 1) { flags.yaCompleta++; continue; } // ya enganchada en la app
      // movimiento con capacidad libre suficiente
      const usable = cands.filter((m) => (movCap.get(m.id) ?? 0) - (usedMovInRun.get(m.id) ?? 0) >= a.abono - 2);
      if (usable.length === 0) { flags.noMov++; if (ejNoMov.length < 8) ejNoMov.push(`   ${a.key} ${fmt(a.abono)} ${row.date} (${inv.businessName?.slice(0, 24)}) — mov no está sin_asignar en la app`); continue; }
      if (usable.length > 1) { flags.ambiguo++; if (ejAmbiguo.length < 8) ejAmbiguo.push(`   ${a.key} ${fmt(a.abono)} ${row.date} — ${usable.length} movs candidatos`); continue; }
      const m = usable[0];
      // CHEQUEO PROVEEDOR: el RUT/glosa del mov debe confirmar que es ese proveedor.
      // Evita la trampa "calzó por monto" (caso Sodimac=transferencia a MJ).
      if (!proveedorConfirmado(m, inv.rutIssuer, inv.businessName)) {
        flags.noConfirma++;
        if (ejNoConfirma.length < 10) ejNoConfirma.push(`   ${a.key} ${fmt(a.abono)} ${row.date} (${inv.businessName?.slice(0, 22)}) — mov: "${m.description.slice(0, 32)}"`);
        continue;
      }
      const amount = Math.min(a.abono, saldo); // no sobre-imputar
      if (amount <= 1) continue;
      plan.push({ movId: m.id, invId: inv.id, amount, folio: a.key.split("|")[0], prov: inv.businessName ?? "", movDate: row.date });
      usedMovInRun.set(m.id, (usedMovInRun.get(m.id) ?? 0) + amount);
      plannedPerInv.set(inv.id, (plannedPerInv.get(inv.id) ?? 0) + amount);
    }
  }

  const facturasTocadas = new Set(plan.map((p) => p.invId));
  const movsTocados = new Set(plan.map((p) => p.movId));
  console.log(`PLAN: enganchar ${plan.length} vínculos → ${facturasTocadas.size} facturas, ${movsTocados.size} movimientos, ${fmt(plan.reduce((s, p) => s + p.amount, 0))}\n`);
  console.log(`Saltados (revisión manual):`);
  console.log(`  - ${flags.noConfirma} donde el mov calza el monto+fecha pero el RUT/glosa NO confirma al proveedor (posible coincidencia tipo Sodimac=transf MJ)`);
  console.log(`  - ${flags.ambiguo} con varios movimientos candidatos (no adivino)`);
  console.log(`  - ${flags.noMov} cuyo movimiento NO está sin_asignar en la app (ya enganchado en otra, o sin_factura)`);
  console.log(`  - ${flags.sinFactura} sin la factura en la app · ${flags.yaCompleta} ya enganchadas (saldo 0)\n`);
  if (ejNoConfirma.length) console.log("  ej. NO confirma proveedor (NO se engancha):\n" + ejNoConfirma.join("\n"));
  if (ejAmbiguo.length) console.log("\n  ej. ambiguos:\n" + ejAmbiguo.join("\n"));

  // muestra del plan
  console.log(`\nej. del plan (vínculos a crear):`);
  for (const p of plan.slice(0, 15)) console.log(`   ${p.movDate}  ${fmt(p.amount).padStart(12)}  folio ${p.folio.padEnd(10)}  ${p.prov.slice(0, 30)}`);

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──────────────────────────────────────────────────────────────
  const { recomputeInvoiceStatus } = await import("../src/lib/banco/invoicePayments");
  let creados = 0;
  for (const p of plan) {
    // idempotencia: no duplicar si ya existe el vínculo
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.movId, invoiceId: p.invId } });
    if (exists) continue;
    await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: p.invId, amountApplied: p.amount, autoMatched: true } });
    creados++;
  }
  // marcar movimientos como conciliados y recalcular estados
  for (const movId of movsTocados) await prisma.bankMovement.update({ where: { id: movId }, data: { status: "conciliado" } });
  for (const invId of facturasTocadas) await recomputeInvoiceStatus(invId);
  console.log(`\nEscritos: ${creados} InvoicePayment, ${movsTocados.size} movimientos → conciliado.`);

  // verificación gasto
  const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
  const gasto = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`Gasto recibidas no-anuladas (debe seguir = $515.459.567): ${fmt(gasto)}`);
  const sinAsignar = await prisma.bankMovement.count({ where: { bankAccountId: "ba_op_blarq", status: "sin_asignar" } });
  console.log(`Movimientos Operativa sin_asignar restantes: ${sinAsignar}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
