// READ-ONLY — para cada NC "reembolso" (G2: factura ya pagada + NC suelta),
// busca en el banco si hubo un ABONO (entrada de plata) de ese proveedor por ese
// monto. Si lo hay → la NC es bank_refund (te devolvieron la plata, conciliable).
// Si no → fue efectivo o crédito que te dejaron adentro (decisión de MJ).
//
// NO escribe nada. Uso:
//   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/buscar-reembolsos-nc.ts

import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const rut8 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-8);
const noZero = (s: any) => String(s ?? "").replace(/^0+/, "");
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const FACT_TD = [33, 34, 39, 41, 56];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── export Maxxa: NC → factura ref ──
  const wb = XLSX.readFile(join(homedir(), "Downloads", "exportar (2).xls"));
  const xr = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const H = xr[0]; const ci = (n: string) => H.indexOf(n);
  const cTd = ci("CodTipoDoc"), cF = ci("FolioDoc"), cR = ci("RutDoc"), cFdr = ci("FolioDocRef");
  const refDeNC = new Map<string, string>();
  for (let i = 1; i < xr.length; i++) { if (String(xr[i][cTd]) !== "61") continue; const fr = noZero(xr[i][cFdr]); if (fr) refDeNC.set(`${noZero(xr[i][cF])}|${rut8(xr[i][cR])}`, fr); }

  // ── recibidas → G2 (NC suelta cuya factura ya está pagada) ──
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

  // ── abonos del banco (entradas de plata) ──
  const abonos = await prisma.bankMovement.findMany({
    where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] }, amount: { gt: 0 } },
    select: { id: true, date: true, amount: true, description: true, counterpartyName: true, counterpartyRut: true, status: true, payments: { select: { invoiceId: true } } },
  });

  console.log(`Buscando reembolsos en el banco para ${g2.length} NC (G2)\n`);
  let conAbono = 0, sinAbono = 0;
  for (const nc of g2.sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))) {
    const monto = Math.abs(nc.totalAmount);
    const rut = rut8(nc.rutIssuer);
    const prov = norm(nc.businessName).split(" ").filter((w: string) => w.length > 3)[0] ?? "";
    // abono que calza: monto ±2 Y (mismo RUT contraparte o glosa/nombre menciona al proveedor)
    const cand = abonos.filter((a) => {
      if (Math.abs(a.amount - monto) > 2) return false;
      const rutOk = rut8(a.counterpartyRut) === rut && rut.length >= 7;
      const glosaOk = prov.length > 3 && (norm(a.description).includes(prov) || norm(a.counterpartyName).includes(prov));
      return rutOk || glosaOk;
    });
    if (cand.length) {
      conAbono++;
      const a = cand[0];
      console.log(`  ✓ NC f${noZero(nc.folioNumber)} ${(nc.businessName ?? "").slice(0, 22).padEnd(22)} ${fmt(monto).padStart(11)} → ABONO ${a.date.toISOString().slice(0, 10)} ${fmt(a.amount)} "${a.description.slice(0, 30)}" [${a.status}]${cand.length > 1 ? ` (+${cand.length - 1} más)` : ""}`);
      console.log(`       → bank_refund (te devolvieron la plata)`);
    } else {
      sinAbono++;
      console.log(`  ·  NC f${noZero(nc.folioNumber)} ${(nc.businessName ?? "").slice(0, 22).padEnd(22)} ${fmt(monto).padStart(11)} → sin abono que calce → efectivo o crédito adentro`);
    }
  }
  console.log(`\nResumen: ${conAbono} con abono (bank_refund) · ${sinAbono} sin abono (efectivo / crédito adentro).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
