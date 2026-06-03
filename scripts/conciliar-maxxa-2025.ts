// Concilia facturas 2025 + 2026 contra los movimientos del banco usando la
// conciliación de Maxxa (cartolas .xlsx, columna Asignacion con id_pago estable).
//
// Qué hace (ronda 49):
//   - Matchea cada asignación de Maxxa a la factura de la app (emitida por
//     tipoDoc{33,34,61,39}|folio — el correlativo BLARQ; recibida por
//     tipoDoc|folio|rut) y al movimiento del banco por (fecha,|monto|).
//   - NO degrada estado: a una factura ya "pagada" SIN enlace al banco solo le
//     agrega el vínculo (sigue pagada). Vincula por saldo real invRem
//     (totalAmount - pagos), no por el campo status: una pagada sin pagos tiene
//     invRem=total y se vincula; una pagada con pagos tiene invRem~0 y se salta.
//   - Transferencias gemelas (dos transferencias reales idénticas el mismo día):
//     dedup de filas de cartola por la identidad estable de Maxxa (set de
//     id_pago de la asignación), NO por fecha|monto|desc — que las colapsaría. Y
//     consume un movimiento de app DISTINTO por cada fila de cartola.
//   - Guard de signo: emitida (cobro) solo con ABONO (+), recibida (gasto) solo
//     con CARGO (-). Evita matches por colisión de folio.
// Capacity-guarded. Dry-run default; --apply escribe. Backups: capturar la salida.
import "dotenv/config";
import { readFileSync } from "fs";
import XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { recomputeInvoiceStatus } from "../src/lib/banco/invoicePayments";

const APPLY = process.argv.includes("--apply");
const DIR_2025 = "/Users/mjblanco/Downloads/2025_Maxxa";
const DIR_DL = "/Users/mjblanco/Downloads";
const normRut = (s: string) => String(s || "").replace(/[.\s]/g, "").replace(/^0+/, "").toUpperCase();
const normFolio = (s: string) => String(s ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
const num = (s: any) => { const n = Number(String(s ?? "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : Math.round(n); };
const ymd = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
const gl = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
// Folios que NO se deben tocar (decisión MJ / handoff). F-5705931: "fantasma"
// Servipag, ya está bien con $12.275 — el dry-run propone un parcial espurio.
const EXCLUDE_FOLIOS = new Set(["5705931"]);

// Una fila de cartola = un movimiento físico del banco con su arreglo de
// asignaciones. Cada asignación trae id_pago (identidad estable de Maxxa).
function loadCart(path: string) {
  const wb = XLSX.read(readFileSync(path));
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  const H = rows[0];
  const ci = (n: string) => H.indexOf(n);
  return rows.slice(1).filter((r) => r.length > 3).map((r) => {
    let asign: any[] = [];
    const raw = r[ci("Asignacion")];
    if (raw && raw !== "") {
      try {
        const j = JSON.parse(String(raw).split("];")[0] + "]");
        asign = j.map((a: any) => ({
          idPago: String(a.id_pago ?? ""),
          folio: normFolio(a.Folio),
          rut: normRut(a.Rut),
          tipoDoc: Number(a.TipoDoc),
          abono: num(a.Abono),
          tipoMov: a.TipoMov,
        }));
      } catch {}
    }
    return { desc: r[ci("descripcion")], monto: num(r[ci("monto")]), fecha: ymd(r[ci("fecha_transaccion")]), asign };
  });
}

async function main() {
  console.log("Modo:", APPLY ? "APPLY" : "DRY-RUN");
  // 2025: 4 exports (1721/1722 ene-mar, 2356 mar-jul, 2355 jul-dic).
  // 2026: 4 cartolas (1832/1834/1912/2156) — todas con columna Asignacion.
  const cartola = [
    ...loadCart(DIR_2025 + "/MovimientosCartola_20260601_1721.xlsx"),
    ...loadCart(DIR_2025 + "/MovimientosCartola_20260601_1722.xlsx"),
    ...loadCart(DIR_2025 + "/MovimientosCartola_20260530_2356.xlsx"),
    ...loadCart(DIR_2025 + "/MovimientosCartola_20260530_2355.xlsx"),
    ...loadCart(DIR_DL + "/MovimientosCartola_20260530_1832.xlsx"),
    ...loadCart(DIR_DL + "/MovimientosCartola_20260530_1834.xlsx"),
    ...loadCart(DIR_DL + "/MovimientosCartola_20260530_1912.xlsx"),
    ...loadCart(DIR_DL + "/MovimientosCartola_20260530_2156.xlsx"),
  ];
  // Solo filas con asignación. Dedup de filas por la identidad estable de Maxxa:
  // el set ordenado de id_pago de sus asignaciones. Los 4+4 exports se solapan
  // (la misma fila física aparece varias veces con el mismo set de id_pago) ->
  // se colapsa a una. Dos transferencias gemelas tienen id_pago DISTINTOS ->
  // sobreviven como dos filas (lo que el dedup viejo por fecha|monto|desc rompía).
  const withAsign = cartola.filter((m) => m.asign.length > 0);
  const seen = new Set<string>();
  const cart = withAsign.filter((m) => {
    const k = m.asign.map((a) => a.idPago).sort().join(",");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Orden estable para que la asignación de movimientos gemelos sea determinista.
  cart.sort((a, b) => (a.fecha + a.monto).localeCompare(b.fecha + b.monto) || a.asign[0].idPago.localeCompare(b.asign[0].idPago));
  console.log("Filas de cartola con asignación (dedup por id_pago):", cart.length);

  const inv = await prisma.invoice.findMany({
    where: { issueDate: { gte: new Date("2024-12-01"), lte: new Date("2026-12-31T23:59:59") } },
    select: { id: true, type: true, tipoDoc: true, folioNumber: true, rutIssuer: true, totalAmount: true, status: true, issueDate: true },
  });
  const idxRec = new Map(inv.filter((i) => i.type === "recibida").map((i) => [i.tipoDoc + "|" + normFolio(i.folioNumber) + "|" + normRut(i.rutIssuer), i]));
  const idxEmi = new Map(inv.filter((i) => i.type === "emitida").map((i) => [i.tipoDoc + "|" + normFolio(i.folioNumber), i]));
  const movs = await prisma.bankMovement.findMany({
    where: { date: { gte: new Date("2025-01-01"), lte: new Date("2026-12-31T23:59:59") } },
    select: { id: true, date: true, amount: true, description: true, status: true },
  });
  const movIdx = new Map<string, any[]>();
  for (const m of movs) { const k = ymd(m.date) + "|" + Math.abs(Math.round(m.amount)); if (!movIdx.has(k)) movIdx.set(k, []); movIdx.get(k)!.push(m); }
  const pays = await prisma.invoicePayment.findMany({ select: { bankMovementId: true, invoiceId: true, amountApplied: true } });
  const appliedByMov = new Map<string, number>(); const appliedByInv = new Map<string, number>();
  for (const p of pays) { appliedByMov.set(p.bankMovementId, (appliedByMov.get(p.bankMovementId) || 0) + p.amountApplied); appliedByInv.set(p.invoiceId, (appliedByInv.get(p.invoiceId) || 0) + p.amountApplied); }

  // matchMov stateful: consume un movimiento de app DISTINTO por fila de cartola.
  // Para gemelas (misma fecha+monto, 2 movimientos en el banco) cada fila se
  // queda con uno distinto. Si la app solo tiene 1 (su import dedupó), la 2da
  // fila no encuentra movimiento libre -> noMov (se deja para revisión manual,
  // no se sobre-imputa el único movimiento).
  const usedMov = new Set<string>();
  const matchMov = (cm: any) => {
    const cands = (movIdx.get(cm.fecha + "|" + Math.abs(cm.monto)) || []).filter((x: any) => !usedMov.has(x.id));
    if (!cands.length) return null;
    const g = gl(cm.desc).slice(0, 14);
    const pick = cands.find((x: any) => gl(x.description).slice(0, 14) === g) || cands[0];
    usedMov.add(pick.id);
    return pick;
  };

  const planMov = new Map<string, number>(), planInv = new Map<string, number>();
  const writes: any[] = []; let noMov = 0, noFact = 0, yaConc = 0, badSign = 0;
  for (const cm of cart) {
    const mov = matchMov(cm); if (!mov) { noMov++; continue; }
    const movCap = () => Math.abs(mov.amount) - (appliedByMov.get(mov.id) || 0) - (planMov.get(mov.id) || 0);
    for (const a of cm.asign) {
      // Emitidas BLARQ: tipoDoc{33,34,61,39}|folio. NO matcheamos por folio solo:
      // los docs Maxxa 1043/1054 (pagos sin factura / otros) colisionan con el
      // correlativo de emitidas (ej: Sodimac folio 75 = emitida F-75) y crearían
      // enlaces falsos. Los cobros 1054 reales (Ovalle) igual entran por su
      // asignación tipoDoc-33 paralela.
      const f =
        a.tipoDoc === 33 || a.tipoDoc === 34 || a.tipoDoc === 61 || a.tipoDoc === 39
          ? idxEmi.get(a.tipoDoc + "|" + a.folio) || idxRec.get(a.tipoDoc + "|" + a.folio + "|" + a.rut)
          : idxRec.get(a.tipoDoc + "|" + a.folio + "|" + a.rut);
      if (!f) { noFact++; continue; }
      if (EXCLUDE_FOLIOS.has(normFolio(f.folioNumber))) continue;
      // Coherencia de signo: emitida (cobro) solo con ABONO (+); recibida (gasto)
      // solo con CARGO (-). Evita matches por colisión de folio.
      if (!((f.type === "emitida" && mov.amount > 0) || (f.type === "recibida" && mov.amount < 0))) { badSign++; continue; }
      // Saldo real (no el campo status): una pagada SIN pagos tiene invRem=total
      // -> se vincula; una pagada CON pagos tiene invRem~0 -> se salta sola.
      const invRem = f.totalAmount - (appliedByInv.get(f.id) || 0) - (planInv.get(f.id) || 0);
      if (invRem < 1) { yaConc++; continue; }
      const apply = Math.min(a.abono || invRem, invRem, movCap());
      if (apply < 1) continue;
      planMov.set(mov.id, (planMov.get(mov.id) || 0) + apply); planInv.set(f.id, (planInv.get(f.id) || 0) + apply);
      writes.push({ movId: mov.id, invId: f.id, amount: Math.round(apply) });
    }
  }

  const yearOf = (d: any) => ymd(d).slice(0, 4);
  const movById = new Map(movs.map((m) => [m.id, m as any]));
  const invById = new Map(inv.map((i) => [i.id, i as any]));
  console.log("\nImputaciones a crear:", writes.length, "| Σ $" + fmt(writes.reduce((s, w) => s + w.amount, 0)));
  console.log("Facturas distintas a conciliar:", new Set(writes.map((w) => w.invId)).size, "| movimientos:", new Set(writes.map((w) => w.movId)).size);
  console.log("Cartola: mov sin match libre en app:", noMov, "| asignación sin factura en app:", noFact, "| ya pagada/sin saldo:", yaConc, "| signo incoherente (descartado):", badSign);
  // Detalle legible, agrupado por año del movimiento.
  for (const yr of ["2025", "2026"]) {
    const ws = writes.filter((w) => yearOf(movById.get(w.movId).date) === yr);
    if (!ws.length) continue;
    console.log(`\n=== ${yr} — ${ws.length} imputaciones, Σ $${fmt(ws.reduce((s, w) => s + w.amount, 0))} ===`);
    for (const w of ws) {
      const m = movById.get(w.movId); const f = invById.get(w.invId);
      const era = f.status === "pagada" ? " [pagada-sin-enlace]" : "";
      console.log(`  ${ymd(m.date)} ${String(m.amount).padStart(10)} ${(m.description || "").slice(0, 28).padEnd(28)} -> F-${f.folioNumber} ${f.type} tipo${f.tipoDoc} $${fmt(w.amount)}${era}`);
    }
  }

  if (!APPLY) { console.log("\n(DRY-RUN — nada escrito)"); await prisma.$disconnect(); return; }

  console.log("\nAPLICANDO...");
  // No degradar pagadas: las que ya estaban "pagada" antes de este run mantienen
  // estado (solo les agregamos el enlace del banco). El resto recompute normal.
  const wasPagada = new Set(inv.filter((i) => i.status === "pagada").map((i) => i.id));
  // Dedup por (mov,factura) — el constraint es unique(bankMovementId,invoiceId).
  const dedup = new Map<string, any>(); for (const w of writes) { const k = w.movId + "|" + w.invId; if (!dedup.has(k)) dedup.set(k, w); }
  const created: any[] = []; const tInv = new Set<string>(), tMov = new Set<string>();
  for (const w of dedup.values()) {
    const ex = await prisma.invoicePayment.findFirst({ where: { bankMovementId: w.movId, invoiceId: w.invId }, select: { id: true } });
    if (!ex) { const p = await prisma.invoicePayment.create({ data: { bankMovementId: w.movId, invoiceId: w.invId, amountApplied: w.amount, autoMatched: false } }); created.push({ id: p.id, ...w }); }
    tInv.add(w.invId); tMov.add(w.movId);
  }
  // Estado del movimiento por su suma imputada.
  for (const movId of tMov) {
    const m = await prisma.bankMovement.findUnique({ where: { id: movId }, select: { amount: true } });
    const ap = (await prisma.invoicePayment.aggregate({ where: { bankMovementId: movId }, _sum: { amountApplied: true } }))._sum.amountApplied ?? 0;
    await prisma.bankMovement.update({ where: { id: movId }, data: { status: ap >= Math.abs(m!.amount) - 1 ? "conciliado" : "parcial" } });
  }
  // Estado de factura: recompute, salvo pagadas-sin-enlace que NO se degradan.
  let restauradas = 0;
  for (const invId of tInv) {
    if (wasPagada.has(invId)) {
      const ps = await prisma.invoicePayment.findMany({ where: { invoiceId: invId }, select: { bankMovement: { select: { date: true } } } });
      const paidAt = ps.reduce<Date | null>((l, p) => { const d = p.bankMovement.date; return !l || d > l ? d : l; }, null);
      await prisma.invoice.update({ where: { id: invId }, data: { status: "pagada", paidAt } });
      restauradas++;
    } else {
      await recomputeInvoiceStatus(invId);
    }
  }
  console.log(`Listo: creadas ${created.length} (deduped ${dedup.size}), ${tInv.size} facturas (${restauradas} pagadas preservadas), ${tMov.size} movimientos.`);
  // Backup de las imputaciones creadas (para revertir).
  const { writeFileSync } = await import("fs");
  writeFileSync("conciliar-maxxa-2025-2026-backup.json", JSON.stringify(created, null, 2));
  console.log("Backup -> conciliar-maxxa-2025-2026-backup.json");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
