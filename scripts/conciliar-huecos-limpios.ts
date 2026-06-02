// Cierra el HUECO LIMPIO: facturas recibidas que la app muestra pendiente/parcial
// pero que tu Maxxa pagó (Maxxa pagó MÁS que lo aplicado en la app), Y donde el
// movimiento que tu cartola asignó a esa factura está LIBRE en la app (suelto o
// ya enganchado a ESA misma factura con capacidad de sobra). Solo esos casos
// obvios — nada de mover un mov que ya paga otra factura.
//
// CANDADOS: solo prod · solo movs sin_asignar/sin_factura o ya-en-esta-factura
//   (NUNCA roba un mov de otra factura) · cap a la capacidad libre del mov y al
//   gap (Maxxa pagó − app aplicó) · idempotente · verifica gasto Δ$0.
//
// DRY-RUN por default. Para aplicar: --apply
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-huecos-limpios.ts

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
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── app: facturas recibidas pendiente/parcial ──
  const invs = await prisma.invoice.findMany({
    where: { type: "recibida", tipoDoc: { not: 61 }, status: { in: ["pendiente", "parcial"] } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, issueDate: true, payments: { select: { amountApplied: true } } },
  });
  const appliedOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);

  // ── export Maxxa: folio|rut → MontoPago (lo que Maxxa pagó) ──
  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const xr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = xr[0]; const ci = (n: string) => H.indexOf(n);
  const cF = ci("FolioDoc"), cR = ci("RutDoc"), cP = ci("MontoPago"), cAnul = ci("Anulada");
  const maxxaPago = new Map<string, number>();
  for (let i = 1; i < xr.length; i++) { if (String(xr[i][cAnul]).toLowerCase() === "si") continue; const k = `${noZero(xr[i][cF])}|${rut8(xr[i][cR])}`; if (k !== "|") maxxaPago.set(k, Number(xr[i][cP]) || 0); }

  // ── cartolas Maxxa: folio|rut → movs que MJ le asignó ──
  const cartolaFiles = ["MovimientosCartola_20260601_1722.xlsx", "MovimientosCartola_20260530_2355.xlsx", "MovimientosCartola_20260530_2356.xlsx"]
    .map((f) => join(homedir(), "Downloads", "2025_Maxxa", f));
  type CMov = { date: string; amount: number; glosa: string };
  const movsPorFactura = new Map<string, CMov[]>();
  const seen = new Set<string>();
  for (const f of cartolaFiles) {
    let raw: any[]; try { raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" }); } catch { continue; }
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i]; if (r[4] === "") continue;
      let arr: any[] = []; if (r[27]) { try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { arr = []; } }
      const idp = arr[0]?.id_pago ? String(arr[0].id_pago) : `row-${r[3]}-${r[4]}-${r[7]}`;
      if (seen.has(idp)) continue; seen.add(idp);
      const mov: CMov = { date: String(r[7]).slice(0, 10), amount: Math.abs(Number(r[4]) || 0), glosa: String(r[3] ?? "") };
      for (const a of arr) { const k = `${noZero(a.Folio)}|${rut8(a.Rut)}`; if (k === "|") continue; if (!movsPorFactura.has(k)) movsPorFactura.set(k, []); movsPorFactura.get(k)!.push(mov); }
    }
  }

  // ── movimientos de la app ──
  const appMovs = await prisma.bankMovement.findMany({
    where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { invoiceId: true, amountApplied: true } } },
  });
  const freeCap = (m: any) => Math.abs(m.amount) - m.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);
  const findAppMov = (m: CMov) => {
    const byAmt = appMovs.filter((x) => Math.abs(Math.abs(x.amount) - m.amount) <= 2);
    if (byAmt.length === 1) return byAmt[0];
    const g = core(m.glosa);
    const byBoth = byAmt.filter((x) => { const cg = core(x.description); return cg && g && (cg.startsWith(g.slice(0, 12)) || g.startsWith(cg.slice(0, 12))); });
    if (byBoth.length === 1) return byBoth[0];
    return null; // ambiguo → no tocar
  };

  // ── armar el plan: solo HUECO + mov libre o ya-en-esta-factura ──
  type Plan = { invId: string; folio: string; prov: string; gap: number; movId: string; movDesc: string; movDate: string; amount: number };
  const plan: Plan[] = [];
  const skip: string[] = [];
  for (const inv of invs) {
    if (new Date(inv.issueDate).getUTCFullYear() >= 2026) continue;
    const k = `${noZero(inv.folioNumber)}|${rut8(inv.rutIssuer)}`;
    const pago = maxxaPago.get(k); if (pago === undefined) continue;
    let gap = pago - appliedOf(inv); if (gap <= 1) continue; // no es hueco
    const movs = movsPorFactura.get(k) ?? [];
    if (!movs.length) continue; // sin cartola → no es de las limpias
    for (const m of movs) {
      if (gap <= 1) break;
      const am = findAppMov(m); if (!am) continue;
      const linked = am.payments.map((p) => p.invoiceId);
      const yaEnOtra = linked.some((id) => id !== inv.id);
      const yaEnEsta = linked.includes(inv.id);
      // candado: el mov debe estar suelto, o ya en ESTA factura. Nunca robarlo de otra.
      if (yaEnOtra && !yaEnEsta) { skip.push(`f${noZero(inv.folioNumber)} ${inv.businessName?.slice(0, 20)}: el mov de ${m.date} (${fmt(m.amount)}) ya paga otra factura → no se toca`); continue; }
      const libre = freeCap(am);
      if (libre <= 1) { skip.push(`f${noZero(inv.folioNumber)} ${inv.businessName?.slice(0, 20)}: el mov de ${m.date} no tiene capacidad libre`); continue; }
      const amount = Math.min(libre, gap);
      plan.push({ invId: inv.id, folio: noZero(inv.folioNumber), prov: inv.businessName ?? "", gap, movId: am.id, movDesc: am.description, movDate: am.date.toISOString().slice(0, 10), amount });
      gap -= amount;
    }
  }

  // ── mostrar plan ──
  const totApply = plan.reduce((s, p) => s + p.amount, 0);
  const facturas = new Set(plan.map((p) => p.invId));
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN (no escribe)"} — cierre de huecos limpios\n`);
  console.log(`${facturas.size} facturas · ${plan.length} enganches · ${fmt(totApply)} a aplicar\n`);
  for (const p of plan)
    console.log(`  f${p.folio} ${p.prov.slice(0, 26).padEnd(26)} ← ${p.movDate} "${p.movDesc.slice(0, 26)}" aplicar ${fmt(p.amount)} (gap ${fmt(p.gap)})`);
  if (skip.length) { console.log(`\nNo tocados (no obvios):`); skip.forEach((s) => console.log(`  ${s}`)); }

  if (!APPLY) { console.log(`\nPara aplicar: agregá --apply (hace backup y verifica gasto Δ$0).`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  const gastoAntes = invs.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  const recompute = new Set<string>();
  const movAplicado = new Map<string, number>();
  for (const p of plan) {
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.movId, invoiceId: p.invId } });
    if (exists) { // top-up: subir el amountApplied
      await prisma.invoicePayment.update({ where: { id: exists.id }, data: { amountApplied: exists.amountApplied + p.amount } });
    } else {
      await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: p.invId, amountApplied: p.amount, autoMatched: false } });
    }
    movAplicado.set(p.movId, (movAplicado.get(p.movId) ?? 0) + p.amount);
    recompute.add(p.invId);
  }
  // estado de cada mov tocado
  for (const movId of movAplicado.keys()) {
    const mv = appMovs.find((x) => x.id === movId)!;
    const yaTenia = mv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const total = yaTenia + (movAplicado.get(movId) ?? 0);
    await prisma.bankMovement.update({ where: { id: movId }, data: { status: total >= Math.abs(mv.amount) - 1 ? "conciliado" : "parcial" } });
  }
  for (const id of recompute) await recomputeInvoiceStatus(id);
  const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
  const gastoPost = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nAPLICADO: ${recompute.size} facturas recalculadas, ${movAplicado.size} movs actualizados.`);
  console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (debe ser igual)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
