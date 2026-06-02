// Compensa las NC "reembolso" (G2: factura ya pagada + NC suelta) según cómo
// devuelve cada comercio (confirmado por MJ):
//   - SODIMAC → cash_refund (te devuelven en efectivo; no hay abono en el banco).
//   - el resto con un ABONO en el banco que calza → bank_refund (vincula el abono
//     y lo deja conciliado, igual que el endpoint /facturas/[id]/compensar).
//   - los demás (sin regla clara) → se dejan sin tocar y se listan para MJ.
//
// Replica la lógica de POST /api/facturas/[id]/compensar. NO toca la factura
// objetivo (ya está pagada por banco; el reembolso es aparte). NO mueve gasto.
//
// DRY-RUN por default. Aplicar: --apply
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/compensar-nc-reembolsos.ts

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const FACT_TD = [33, 34, 39, 41, 56];
const SODIMAC = "96792430";

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const xr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = xr[0]; const ci = (n: string) => H.indexOf(n);
  const cTd = ci("CodTipoDoc"), cF = ci("FolioDoc"), cR = ci("RutDoc"), cFdr = ci("FolioDocRef");
  const refDeNC = new Map<string, string>();
  for (let i = 1; i < xr.length; i++) { if (String(xr[i][cTd]) !== "61") continue; const fr = noZero(xr[i][cFdr]); if (fr) refDeNC.set(`${noZero(xr[i][cF])}|${rut8(xr[i][cR])}`, fr); }

  const rec = await prisma.invoice.findMany({ where: { type: "recibida" }, select: { id: true, tipoDoc: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, referenceFolioNumber: true, compensationType: true, payments: { select: { amountApplied: true } } } });
  const facturas = rec.filter((i) => i.tipoDoc !== 61);
  const factByKey = new Map<string, any>(); for (const f of facturas) factByKey.set(`${noZero(f.folioNumber)}|${rut8(f.rutIssuer)}`, f);
  const paidOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0);
  const g2: any[] = [];
  for (const nc of rec) {
    if (nc.tipoDoc !== 61 || nc.referenceFolioNumber || nc.compensationType) continue;
    const ref = refDeNC.get(`${noZero(nc.folioNumber)}|${rut8(nc.rutIssuer)}`); if (!ref) continue;
    const f = factByKey.get(`${ref}|${rut8(nc.rutIssuer)}`); if (!f || !FACT_TD.includes(f.tipoDoc)) continue;
    if (paidOf(f) >= f.totalAmount - 10) g2.push(nc);
  }

  const abonos = await prisma.bankMovement.findMany({
    where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] }, amount: { gt: 0 } },
    select: { id: true, date: true, amount: true, description: true, counterpartyName: true, counterpartyRut: true, status: true },
  });
  const matchAbono = (nc: any) => {
    const monto = Math.abs(nc.totalAmount), rut = rut8(nc.rutIssuer);
    const prov = norm(nc.businessName).split(" ").filter((w: string) => w.length > 3)[0] ?? "";
    const cand = abonos.filter((a) => Math.abs(a.amount - monto) > 2 ? false : (rut8(a.counterpartyRut) === rut && rut.length >= 7) || (prov.length > 3 && (norm(a.description).includes(prov) || norm(a.counterpartyName).includes(prov))));
    return cand.length === 1 ? cand[0] : null; // solo si es ÚNICO (evita ambigüedad)
  };

  type Act = { nc: any; tipo: "cash_refund" | "bank_refund"; abono?: any };
  const acts: Act[] = [];
  const dejar: string[] = [];
  for (const nc of g2.sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))) {
    if (rut8(nc.rutIssuer) === SODIMAC) { acts.push({ nc, tipo: "cash_refund" }); continue; }
    const ab = matchAbono(nc);
    if (ab) { acts.push({ nc, tipo: "bank_refund", abono: ab }); continue; }
    dejar.push(`NC f${noZero(nc.folioNumber)} ${(nc.businessName ?? "").slice(0, 24).padEnd(24)} ${fmt(Math.abs(nc.totalAmount)).padStart(11)} → sin regla (ni Sodimac ni abono que calce)`);
  }

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN (no escribe)"} — compensar NC reembolso\n`);
  const cash = acts.filter((a) => a.tipo === "cash_refund"), bank = acts.filter((a) => a.tipo === "bank_refund");
  console.log(`── ${cash.length} Sodimac → cash_refund (efectivo) ──`);
  for (const a of cash) console.log(`  NC f${noZero(a.nc.folioNumber)} ${fmt(Math.abs(a.nc.totalAmount)).padStart(11)}`);
  console.log(`\n── ${bank.length} → bank_refund (abono al banco, se concilia) ──`);
  for (const a of bank) console.log(`  NC f${noZero(a.nc.folioNumber)} ${(a.nc.businessName ?? "").slice(0, 20)} ${fmt(Math.abs(a.nc.totalAmount)).padStart(11)} ← abono ${a.abono.date.toISOString().slice(0, 10)} "${a.abono.description.slice(0, 28)}" [${a.abono.status}]`);
  if (dejar.length) { console.log(`\n── ${dejar.length} sin tocar (decisión MJ) ──`); dejar.forEach((s) => console.log(`  ${s}`)); }

  if (!APPLY) { console.log(`\nPara aplicar: --apply`); await prisma.$disconnect(); return; }

  let n = 0, ab = 0;
  for (const a of acts) {
    const data: any = { compensationType: a.tipo, appliedToInvoiceId: null, refundBankMovementId: null, status: "pagada", paidAt: new Date() };
    if (a.tipo === "bank_refund") {
      data.refundBankMovementId = a.abono.id;
      if (a.abono.status === "sin_asignar") { await prisma.bankMovement.update({ where: { id: a.abono.id }, data: { status: "conciliado", category: "reembolso_proveedor" } }); ab++; }
    }
    await prisma.invoice.update({ where: { id: a.nc.id }, data });
    n++;
  }
  console.log(`\nAPLICADO: ${n} NC compensadas (${cash.length} efectivo + ${bank.length} banco), ${ab} abonos conciliados.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
