// Registra la mano de obra de los Pedros Barrera en Quincho La Llaveria
// (14 transferencias, $2.935.000) que hoy no está cargada. Replica EXACTO
// la lógica de "Pago sin factura" (bulk/route.ts): por cada movimiento crea
// un Invoice sin_respaldo (tipoDoc 1043) → Quincho + Mano de obra, y lo
// concilia. Dry-run por default; --apply escribe. Snapshot antes/después.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const BLARQ_RUT = "77270733-9";
const PROJECT_ID = "cmoj9qhwo0006rtpzfsariccn"; // Quincho La Llaveria (n°57)
const CATEGORY_ID = "cmnwgesse0003rtdevy39x5zc"; // Mano de obra
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const days = (a: Date, b: string) => Math.abs((a.getTime() - new Date(b).getTime()) / 86400000);

// Las 14 transferencias de Quincho La Llaveria [rutFrag, fechaTrabajo, monto]
const P = "11127176", N = "5890859";
const QUINCHO: [string, string, number][] = [
  [P, "2026-01-18", 200000], [P, "2026-01-11", 165000], [P, "2026-01-01", 200000], [P, "2025-12-23", 205000], [P, "2025-12-21", 275000], [P, "2025-12-14", 230000], [P, "2025-12-04", 250000],
  [N, "2026-01-18", 180000], [N, "2026-01-11", 150000], [N, "2026-01-01", 200000], [N, "2025-12-23", 190000], [N, "2025-12-21", 250000], [N, "2025-12-14", 210000], [N, "2025-12-04", 230000],
];

async function quinchoGastado(): Promise<number> {
  const rec = await prisma.invoice.findMany({ where: { projectId: PROJECT_ID, type: "recibida" }, select: { tipoDoc: true, totalAmount: true } });
  return rec.reduce((s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount, 0);
}

async function main() {
  console.log(`Entorno: ${/ep-shy-morning/.test(process.env.DATABASE_URL ?? "") ? "PROD" : "?"} | modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const before = await quinchoGastado();
  console.log(`SNAPSHOT — Quincho La Llaveria gastado (recibidas, neto) ANTES: $${fmt(before)}`);

  const movs = await prisma.bankMovement.findMany({
    where: { description: { contains: "Pedro Barrera" } },
    include: { payments: { select: { id: true } } },
  });
  const used = new Set<string>();
  const plan: any[] = []; const problems: string[] = [];
  for (const [rut, fecha, monto] of QUINCHO) {
    const cands = movs.filter((m) => !used.has(m.id) && Math.abs(Math.round(m.amount)) === monto && (m.counterpartyRut || "").includes(rut) && days(m.date, fecha) <= 5).sort((a, b) => days(a.date, fecha) - days(b.date, fecha));
    if (!cands.length) { problems.push(`${rut} ${fecha} $${fmt(monto)}: no se encontró el movimiento`); continue; }
    const m = cands[0];
    if (m.amount >= 0) { problems.push(`${m.id}: no es egreso`); continue; }
    if (m.payments.length) { problems.push(`mov ${ymd(m.date)} $${fmt(monto)}: ya tiene imputación — se omite`); continue; }
    used.add(m.id);
    plan.push({ movId: m.id, fecha: m.date, monto: Math.abs(m.amount), rut: m.counterpartyRut, nom: m.counterpartyName, externalRef: m.externalRef });
  }

  console.log(`\nMovimientos a registrar: ${plan.length} de 14 | Σ $${fmt(plan.reduce((s, p) => s + p.monto, 0))}`);
  plan.forEach((p) => console.log(`  ${ymd(p.fecha)}  $${fmt(p.monto)}  ${p.nom} [${p.rut}]  → SR-${p.externalRef || p.movId}`));
  if (problems.length) { console.log(`\nProblemas (${problems.length}):`); problems.forEach((s) => console.log("  - " + s)); }

  if (!APPLY) { console.log(`\n(DRY-RUN — nada escrito. Quincho quedaría en $${fmt(before + plan.reduce((s,p)=>s+p.monto,0))}). --apply para aplicar`); await prisma.$disconnect(); return; }
  if (problems.length) { console.log("\nHay problemas — no aplico hasta resolverlos."); await prisma.$disconnect(); process.exit(1); }

  console.log("\nAPLICANDO...");
  console.log("(secuencial, sin transacción interactiva — el pooler de Neon no las soporta)");
  let done = 0;
  for (const p of plan) {
    const existing = await prisma.invoicePayment.count({ where: { bankMovementId: p.movId } });
    if (existing > 0) { console.log(`  (ya hecho) ${ymd(p.fecha)} $${fmt(p.monto)}`); continue; }
    const folio = `SR-${p.externalRef || p.movId}`;
    const inv = await prisma.invoice.create({
      data: {
        projectId: PROJECT_ID, categoryId: CATEGORY_ID, type: "recibida", tipoDoc: 1043,
        folioNumber: folio, rutIssuer: p.rut, rutReceiver: BLARQ_RUT, businessName: p.nom,
        issueDate: p.fecha, dueDate: p.fecha, netAmount: p.monto, iva: 0, totalAmount: p.monto,
        status: "pagada", paidAt: p.fecha, origin: "sin_respaldo",
        notes: "Pago sin documento tributario (mano de obra Pedro Barrera, Quincho La Llaveria). Creado desde cruce Maxxa/comprobantes JT.",
      },
    });
    await prisma.invoicePayment.create({ data: { bankMovementId: p.movId, invoiceId: inv.id, amountApplied: p.monto, autoMatched: false } });
    await prisma.bankMovement.update({ where: { id: p.movId }, data: { status: "conciliado", category: null } });
    done++;
  }
  const orphans = await prisma.invoice.findMany({ where: { projectId: PROJECT_ID, origin: "sin_respaldo", payments: { none: {} } }, select: { folioNumber: true } });
  const after = await quinchoGastado();
  console.log(`Listo: ${done} registros creados${orphans.length ? ` | ⚠ HUÉRFANOS: ${orphans.length} (${orphans.map((o) => o.folioNumber).join(", ")})` : ""}.`);
  console.log(`SNAPSHOT — Quincho gastado DESPUÉS: $${fmt(after)} | Δ $${fmt(after - before)} (esperado +$${fmt(plan.reduce((s,p)=>s+p.monto,0))})`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
