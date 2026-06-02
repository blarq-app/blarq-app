// CRUCE COMPLETO por glosa (PREMISA MJ: Maxxa manda). Fuente: el export de
// facturas de Maxxa `exportar (2).xls`, que trae por factura la glosa del
// movimiento que la concilió (columna DetallePago) — un solo mov por factura.
//
// Para cada factura de Maxxa con glosa de pago, busca en la app:
//   - la factura (folio+rut),
//   - el movimiento que la pagó, por GLOSA + monto (no solo monto).
// Y clasifica la acción para igualar la app a Maxxa:
//   ENGANCHAR   — la factura tiene saldo y el mov está libre (sin_factura/
//                 sin_asignar) → crear el pago.
//   MOVER       — el mov está conciliado a OTRA factura → habría que moverlo.
//   YA_OK       — la app ya tiene esa factura pagada.
//   NO_MOV      — no encuentro el mov en la app (por glosa+monto).
//   NO_FACTURA  — la factura no está en la app.
//
// SOLO DRY-RUN (no escribe). Escribe un Excel con el plan para revisar.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/cruce-glosa-maxxa.ts

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
const core = (s: any) => norm(s).replace(/^\d+\s*/, "").replace(/\s+/g, " ").trim(); // saca el nro de cuenta inicial

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── export de facturas Maxxa ──
  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = rows[0]; const ci = (n: string) => H.indexOf(n);
  const cF = ci("FolioDoc"), cR = ci("RutDoc"), cN = ci("NomAux"), cP = ci("MontoPago"), cS = ci("Saldo"), cD = ci("DetallePago"), cC = ci("CentroCosto"), cT = ci("CodTipoDoc"), cAnul = ci("Anulada");
  type MxF = { folio: string; rut: string; nom: string; pago: number; saldo: number; glosa: string; cc: string; tipoDoc: string };
  const maxxa: MxF[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const glosa = String(r[cD] ?? "").trim();
    if (!glosa) continue;                                  // sin glosa de pago → nada que cruzar
    if (String(r[cAnul]).toLowerCase() === "si") continue; // anuladas fuera
    if (Number(r[cP]) <= 0) continue;
    maxxa.push({ folio: String(r[cF]).replace(/^0+/, ""), rut: rut8(r[cR]), nom: String(r[cN]), pago: Number(r[cP]) || 0, saldo: Number(r[cS]) || 0, glosa, cc: String(r[cC]), tipoDoc: String(r[cT]) });
  }

  // ── app en vivo ──
  const invs = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, payments: { select: { amountApplied: true } } } });
  const facByKey = new Map<string, any>();
  for (const inv of invs) { const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`; if (k !== "|") facByKey.set(k, inv); }
  const paid = new Map<string, number>();
  for (const inv of invs) paid.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));

  const movs = await prisma.bankMovement.findMany({ where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { invoiceId: true } } } });

  // ── cruzar ──
  type Out = { accion: string; folio: string; prov: string; ccMaxxa: string; pagoMaxxa: number; glosa: string; saldoApp: number; estadoApp: string; detalle: string };
  const out: Out[] = [];
  type Act = { accion: string; movId: string; invId: string; amount: number; movAbs: number; otherInvIds: string[] };
  const actions: Act[] = [];
  for (const m of maxxa) {
    const inv = facByKey.get(`${m.folio}|${m.rut}`);
    if (!inv) { out.push({ accion: "NO_FACTURA", folio: m.folio, prov: m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp: 0, estadoApp: "—", detalle: "la factura no está en la app" }); continue; }
    const saldoApp = inv.totalAmount - (paid.get(inv.id) ?? 0);
    if (saldoApp <= 1) { out.push({ accion: "YA_OK", folio: m.folio, prov: inv.businessName ?? m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp, estadoApp: inv.status, detalle: "la app ya la tiene pagada" }); continue; }
    // buscar el mov por monto (±2) y glosa
    const g = core(m.glosa);
    const byAmount = movs.filter((x) => Math.abs(Math.abs(x.amount) - m.pago) <= 2);
    const byBoth = byAmount.filter((x) => { const cg = core(x.description); return cg.startsWith(g.slice(0, 14)) || g.startsWith(cg.slice(0, 14)); });
    const cand = byBoth.length === 1 ? byBoth[0] : byBoth.length > 1 ? null : (byAmount.length === 1 ? byAmount[0] : null);
    if (!cand) {
      out.push({ accion: byBoth.length > 1 ? "AMBIGUO" : "NO_MOV", folio: m.folio, prov: inv.businessName ?? m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp, estadoApp: inv.status, detalle: byBoth.length > 1 ? `${byBoth.length} movs calzan glosa+monto` : `no encuentro mov por glosa+monto (${fmt(m.pago)})` });
      continue;
    }
    const linked = cand.payments.map((p) => p.invoiceId);
    if (linked.includes(inv.id)) { out.push({ accion: "YA_OK", folio: m.folio, prov: inv.businessName ?? m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp, estadoApp: inv.status, detalle: "el mov ya está enganchado a esta factura" }); continue; }
    const amount = Math.min(m.pago, saldoApp);
    if (["sin_factura", "sin_asignar"].includes(cand.status) && linked.length === 0) {
      out.push({ accion: "ENGANCHAR", folio: m.folio, prov: inv.businessName ?? m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp, estadoApp: inv.status, detalle: `mov "${cand.description.slice(0, 30)}" (${cand.status}) libre → enganchar` });
      actions.push({ accion: "ENGANCHAR", movId: cand.id, invId: inv.id, amount, movAbs: Math.abs(cand.amount), otherInvIds: [] });
    } else {
      const otras = linked.map((id) => { const o = invs.find((x) => x.id === id); return o ? `f${String(o.folioNumber).replace(/^0+/, "")} ${o.businessName?.slice(0, 18)}` : "?"; });
      out.push({ accion: "MOVER", folio: m.folio, prov: inv.businessName ?? m.nom, ccMaxxa: m.cc, pagoMaxxa: m.pago, glosa: m.glosa, saldoApp, estadoApp: inv.status, detalle: `mov "${cand.description.slice(0, 26)}" hoy en ${otras.join("+")} → mover a esta` });
      actions.push({ accion: "MOVER", movId: cand.id, invId: inv.id, amount, movAbs: Math.abs(cand.amount), otherInvIds: [...new Set(linked)] });
    }
  }

  // ── resumen ──
  const orden = ["ENGANCHAR", "MOVER", "AMBIGUO", "NO_MOV", "NO_FACTURA", "YA_OK"];
  console.log(`Facturas Maxxa con glosa de pago cruzadas: ${maxxa.length}\n`);
  for (const a of orden) {
    const g = out.filter((o) => o.accion === a);
    if (g.length) console.log(`  ${String(g.length).padStart(4)} · ${fmt(g.reduce((s, o) => s + o.pagoMaxxa, 0)).padStart(13)}  ${a}`);
  }

  // ── aplicar (ENGANCHAR + MOVER) ──
  if (APPLY) {
    const gastoAntes = invs.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
    const recompute = new Set<string>();
    let eng = 0, mov = 0;
    for (const a of actions) {
      if (a.accion === "MOVER") {
        // sacar el mov de la(s) factura(s) vieja(s)
        await prisma.invoicePayment.deleteMany({ where: { bankMovementId: a.movId, invoiceId: { in: a.otherInvIds } } });
        a.otherInvIds.forEach((id) => recompute.add(id));
        mov++;
      } else eng++;
      // crear el pago a la factura de Maxxa (idempotente)
      const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: a.movId, invoiceId: a.invId } });
      if (!exists) await prisma.invoicePayment.create({ data: { bankMovementId: a.movId, invoiceId: a.invId, amountApplied: a.amount, autoMatched: false } });
      recompute.add(a.invId);
    }
    // estado de cada mov tocado: conciliado si quedó usado completo, si no parcial
    const movTotApplied = new Map<string, number>();
    for (const a of actions) movTotApplied.set(a.movId, (movTotApplied.get(a.movId) ?? 0) + a.amount);
    for (const [movId, applied] of movTotApplied) {
      const mv = movs.find((x) => x.id === movId)!;
      await prisma.bankMovement.update({ where: { id: movId }, data: { status: applied >= Math.abs(mv.amount) - 1 ? "conciliado" : "parcial" } });
    }
    for (const id of recompute) await recomputeInvoiceStatus(id);
    console.log(`\nAPLICADO: ${eng} enganchados, ${mov} movidos, ${recompute.size} facturas recalculadas.`);
    const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
    const gastoPost = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
    console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (debe ser igual; enganchar/mover pagos no cambia el gasto)`);
  }

  const ws = XLSX.utils.json_to_sheet(out.sort((a, b) => orden.indexOf(a.accion) - orden.indexOf(b.accion) || b.pagoMaxxa - a.pagoMaxxa).map((o) => ({
    Accion: o.accion, Folio: o.folio, Proveedor: o.prov, "Obra Maxxa": o.ccMaxxa, "Pago Maxxa": o.pagoMaxxa,
    "Glosa del mov (Maxxa)": o.glosa, "Saldo en app": o.saldoApp, "Estado app": o.estadoApp, "Detalle": o.detalle,
  })));
  ws["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 26 }, { wch: 22 }, { wch: 12 }, { wch: 34 }, { wch: 12 }, { wch: 10 }, { wch: 50 }];
  const wbo = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbo, ws, "Cruce glosa Maxxa");
  const p = join(homedir(), "Downloads", "Cruce_glosa_Maxxa.xlsx");
  XLSX.writeFile(wbo, p);
  console.log(`\nExcel del plan: ${p}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
