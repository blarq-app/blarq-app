// PUNTO 1 ronda 42 — resolver los 12 AMBIGUO del cruce por glosa usando la CARTOLA.
//
// El cruce por glosa (cruce-glosa-maxxa.ts) dejó 12 facturas AMBIGUO: facturas
// gemelas (mismo proveedor + mismo monto) que competían por un movimiento, porque
// el export de Maxxa NO trae la fecha del pago. La cartola SÍ trae fecha + la
// asignación MANUAL de MJ (columna Asignacion: folio+rut+id_pago por movimiento).
// Eso desambigua qué mov va a qué factura gemela: emparejamos por FECHA.
//
// Lógica (PREMISA MJ: Maxxa manda; su asignación manual es la verdad):
//   - Para cada cluster (proveedor+monto), leo de la cartola las asignaciones
//     (folio → fecha del mov) = lo que MJ decidió a mano.
//   - Busco en la app la factura (folio+rut) y un movimiento LIBRE con esa misma
//     fecha+monto+glosa → creo el InvoicePayment.
//   - Los movs gemelos de 2026 / fuera del rango de Maxxa (sin asignación en la
//     cartola) NO se tocan (no tienen fecha que empareje).
//
// CANDADOS: solo prod (ep-shy-morning) · solo movs LIBRES (sin pago previo) ·
// no sobre-imputa (cap al saldo) · idempotente (salta si el pago ya existe) ·
// verifica que el gasto recibidas no-anuladas NO cambie.
//
// Dry-run por default. Escribe con --apply.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/conciliar-ambiguos-cartola.ts [--apply]

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

// Los 6 clusters ambiguos (proveedor+monto). `key` matchea la glosa del mov.
const CLUSTERS = [
  { label: "Victorino Soto $2.618.000", amount: 2618000, glosaKey: "victorino" },
  { label: "Victorino Soto $1.190.000", amount: 1190000, glosaKey: "victorino" },
  { label: "Transportes Paulo Cesar $95.200", amount: 95200, glosaKey: "paulo" },
  { label: "Paula Johanna / Francisco Arias $107.100", amount: 107100, glosaKey: "francisco aria" },
  { label: "Hector Soto $150.000", amount: 150000, glosaKey: "hector soto" },
  { label: "Frank Harrison $120.000", amount: 120000, glosaKey: "frank harri" },
];

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── cartola Maxxa (3 archivos, dedup por id_pago) = asignación manual de MJ ──
  const maxxaFiles = [
    join(homedir(), "Downloads", "MovimientosCartola_20260601_1722.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2355.xlsx"),
    join(homedir(), "Downloads", "2025_Maxxa", "MovimientosCartola_20260530_2356.xlsx"),
  ];
  type CRow = { date: string; amount: number; desc: string; asigns: any[]; idp: string };
  const crows: CRow[] = [];
  const seenIdp = new Set<string>();
  for (const f of maxxaFiles) {
    const raw = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(f).Sheets["Table1"], { header: 1, defval: "" });
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (r[4] === "") continue;
      let arr: any[] = [];
      if (r[27]) { try { arr = JSON.parse(String(r[27]).split(";")[0]); } catch { arr = []; } }
      const idp = arr[0]?.id_pago ? String(arr[0].id_pago) : `row-${r[3]}-${r[4]}-${r[7]}`;
      if (seenIdp.has(idp)) continue;
      seenIdp.add(idp);
      crows.push({ date: String(r[7]).slice(0, 10), amount: Math.abs(Number(r[4]) || 0), desc: String(r[3] ?? ""), asigns: arr, idp });
    }
  }

  // ── app en vivo ──
  const invs = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, rutIssuer: true, businessName: true, totalAmount: true, status: true, projectId: true, payments: { select: { amountApplied: true } } } });
  const facByKey = new Map<string, any>();
  for (const inv of invs) { const k = `${String(inv.folioNumber ?? "").replace(/^0+/, "")}|${rut8(inv.rutIssuer)}`; if (k !== "|") facByKey.set(k, inv); }
  const appliedByInv = new Map<string, number>();
  for (const inv of invs) appliedByInv.set(inv.id, inv.payments.reduce((s: number, p: any) => s + p.amountApplied, 0));
  const projName = new Map<string, string>((await prisma.project.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name ?? p.id]));

  const movsRaw = await prisma.bankMovement.findMany({ where: { bankAccountId: { in: ["ba_op_blarq", "ba_sueldos_blarq"] } },
    select: { id: true, date: true, amount: true, description: true, status: true, payments: { select: { invoiceId: true } } } });
  // las fechas se guardan a medianoche UTC → tomar el día en UTC (toISOString), NUNCA local (corre un día)
  const movs = movsRaw.map((m) => ({ ...m, dateStr: m.date.toISOString().slice(0, 10) }));

  // ── construir el plan: para cada asignación de la cartola en cada cluster,
  //    empareja factura (folio+rut) con un mov LIBRE de la app por fecha+monto+glosa ──
  type Plan = { cluster: string; folio: string; invId: string; obra: string; movId: string; movDate: string; amount: number; movAbs: number };
  const plan: Plan[] = [];
  const usedMovIds = new Set<string>();
  const warnings: string[] = [];

  for (const c of CLUSTERS) {
    // asignaciones de la cartola para este cluster (mov → folio+rut), con fecha
    const cm = crows.filter((r) => r.amount === c.amount && norm(r.desc).includes(c.glosaKey.split(" ")[0]));
    // movs libres de la app para este cluster
    const freeAppMovs = movs.filter((x) => Math.abs(Math.abs(x.amount) - c.amount) <= 2 && norm(x.description).includes(c.glosaKey.split(" ")[0]) && x.payments.length === 0);

    for (const m of cm) {
      for (const a of m.asigns) {
        const folio = String(a.Folio ?? "").replace(/^0+/, "");
        const rut = rut8(a.Rut);
        const inv = facByKey.get(`${folio}|${rut}`);
        if (!inv) { continue; } // la factura no está en la app (otro folio/rut) — fuera de scope
        const saldo = inv.totalAmount - (appliedByInv.get(inv.id) ?? 0);
        if (saldo <= 1) continue; // ya pagada con broche (idempotente)
        // ¿ya tiene un pago de un mov de este cluster? (idempotente entre corridas)
        // buscar un mov libre de la app con la MISMA fecha que la cartola, no usado aún en este plan
        const cand = freeAppMovs.find((x) => x.dateStr === m.date && !usedMovIds.has(x.id));
        if (!cand) {
          warnings.push(`${c.label}: cartola asigna ${m.date} → f${folio}, pero no hay mov libre app con esa fecha (¿ya enganchado o fuera de rango?)`);
          continue;
        }
        usedMovIds.add(cand.id);
        const amount = Math.min(c.amount, saldo, Math.abs(cand.amount));
        plan.push({ cluster: c.label, folio, invId: inv.id, obra: inv.projectId ? (projName.get(inv.projectId) ?? "-") : "-", movId: cand.id, movDate: cand.dateStr, amount, movAbs: Math.abs(cand.amount) });
      }
    }
  }

  // ── reporte ──
  console.log(`\n${"=".repeat(78)}\nPLAN — resolver AMBIGUO con la cartola (${plan.length} pares factura↔mov)\n${"=".repeat(78)}`);
  let total = 0;
  for (const p of plan) {
    const inv = invs.find((i) => i.id === p.invId)!;
    console.log(`  f${p.folio.padEnd(8)} ${(inv.businessName ?? "").slice(0, 22).padEnd(22)} obra:${p.obra.slice(0, 16).padEnd(16)} ← mov ${p.movDate} ${fmt(p.amount)}  (factura ${inv.status}→pagada, mov libre→conciliado)`);
    total += p.amount;
  }
  console.log(`  ${"-".repeat(72)}\n  TOTAL: ${fmt(total)} en ${plan.length} pares`);
  if (warnings.length) { console.log(`\n  AVISOS (no se actuó):`); for (const w of warnings) console.log(`    - ${w}`); }

  const gastoAntes = invs.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Gasto recibidas no-anuladas actual: ${fmt(gastoAntes)}. Corré con --apply para aplicar.`);
    await prisma.$disconnect();
    return;
  }

  // ── aplicar ──
  const recompute = new Set<string>();
  let created = 0;
  const movApplied = new Map<string, number>();
  for (const p of plan) {
    const exists = await prisma.invoicePayment.findFirst({ where: { bankMovementId: p.movId, invoiceId: p.invId } });
    if (!exists) { await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: p.invId, amountApplied: p.amount, autoMatched: false } }); created++; }
    movApplied.set(p.movId, (movApplied.get(p.movId) ?? 0) + p.amount);
    recompute.add(p.invId);
  }
  for (const [movId, applied] of movApplied) {
    const mv = movs.find((x) => x.id === movId)!;
    await prisma.bankMovement.update({ where: { id: movId }, data: { status: applied >= Math.abs(mv.amount) - 1 ? "conciliado" : "parcial" } });
  }
  for (const id of recompute) await recomputeInvoiceStatus(id);

  const post = await prisma.invoice.findMany({ where: { type: "recibida", tipoDoc: { not: 61 } }, select: { status: true, totalAmount: true } });
  const gastoPost = post.filter((i) => i.status !== "anulada").reduce((s, i) => s + i.totalAmount, 0);
  console.log(`\nAPLICADO: ${created} pagos creados, ${recompute.size} facturas recalculadas.`);
  console.log(`Gasto recibidas no-anuladas: ${fmt(gastoAntes)} → ${fmt(gastoPost)} (Δ ${fmt(gastoPost - gastoAntes)}; debe ser $0).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
