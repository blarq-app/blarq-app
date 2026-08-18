// SOLO LECTURA — panorama del pendiente 162 (devoluciones y NC partidas).
//
// NO usa `import "dotenv/config"` a propósito: eso carga `.env`, que apunta a la
// base VIEJA (ep-solitary-mud). Acá el DATABASE_URL se lee del archivo que se
// pase por argumento, para poder apuntar a la viva (ep-shy-morning). Ver §4.9.
//
//   npx tsx scripts/diag-162-panorama.ts .env.prod
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const url = readFileSync(process.argv[2], "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1]
  .trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);
const linea = (t: string) => console.log(`\n${"─".repeat(78)}\n${t}\n${"─".repeat(78)}`);

async function main() {
  console.log("host:", url.match(/@([^/]+)/)?.[1] ?? "?");

  // ── 0. Marcador de base viva ────────────────────────────────────────────
  linea("0. ¿ESTOY EN LA BASE VIVA?");
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { numeroProyecto: true, name: true },
  });
  const ultima = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { issueDate: true, businessName: true },
  });
  console.log(`  #64 = ${p64?.name ?? "(no existe)"}  ${p64?.name === "Paseo del Sena" ? "OK" : "← NO CALZA"}`);
  console.log(`  última factura: ${ultima ? d(ultima.issueDate) : "—"} (${ultima?.businessName ?? "—"})`);

  // ── 1. Sobrepagos con devolución ────────────────────────────────────────
  linea("1. SOBREPAGOS: movimiento conciliado con sobrante + devolución del mismo monto");
  const movs = await prisma.bankMovement.findMany({
    where: { payments: { some: {} } },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      counterpartyName: true,
      status: true,
      payments: {
        select: {
          amountApplied: true,
          invoice: { select: { folioNumber: true, businessName: true, totalAmount: true } },
        },
      },
    },
  });
  const conSobrante = movs
    .map((m) => ({
      ...m,
      sobrante: Math.abs(m.amount) - m.payments.reduce((s, p) => s + p.amountApplied, 0),
    }))
    .filter((m) => m.sobrante > 100);

  console.log(
    `  movimientos conciliados con sobrante: ${conSobrante.length} · total ${clp(
      conSobrante.reduce((s, m) => s + m.sobrante, 0)
    )}`
  );

  let pares = 0;
  let totalPares = 0;
  for (const m of conSobrante) {
    const desde = new Date(m.date);
    desde.setDate(desde.getDate() - 5);
    const hasta = new Date(m.date);
    hasta.setDate(hasta.getDate() + 60);
    const devol = await prisma.bankMovement.findMany({
      where: {
        amount: { gt: m.sobrante - 50, lt: m.sobrante + 50 },
        date: { gte: desde, lte: hasta },
        payments: { none: {} },
        internalTransferToId: null,
      },
      select: { id: true, date: true, amount: true, description: true, status: true },
    });
    if (!devol.length) continue;
    pares++;
    totalPares += m.sobrante;
    console.log(
      `\n  PAGO ${d(m.date)} ${clp(m.amount).padStart(14)} [${m.status}] ${(m.counterpartyName ?? m.description ?? "").slice(0, 34)}`
    );
    for (const p of m.payments)
      console.log(
        `     factura F-${p.invoice.folioNumber ?? "—"} total ${clp(p.invoice.totalAmount)} · imputado ${clp(p.amountApplied)}`
      );
    console.log(`     SOBRANTE ${clp(m.sobrante)}`);
    for (const v of devol)
      console.log(
        `     ↳ DEVOLUCIÓN ${d(v.date)} ${clp(v.amount).padStart(12)} [${v.status}] ${(v.description ?? "").slice(0, 34)}`
      );
  }
  console.log(`\n  >> pares sobrepago↔devolución: ${pares} · ${clp(totalPares)}`);

  // ── 2. NC con excedente que se pierde ───────────────────────────────────
  linea("2. NC APLICADAS A UNA FACTURA MÁS CHICA (el excedente se pierde sin rastro)");
  const ncsAplicadas = await prisma.invoice.findMany({
    where: { tipoDoc: 61, appliedToInvoiceId: { not: null } },
    select: {
      id: true,
      folioNumber: true,
      issueDate: true,
      totalAmount: true,
      businessName: true,
      appliedToInvoiceId: true,
      projectId: true,
    },
  });
  let excedenteTotal = 0;
  for (const nc of ncsAplicadas) {
    const target = await prisma.invoice.findUnique({
      where: { id: nc.appliedToInvoiceId! },
      select: {
        folioNumber: true,
        totalAmount: true,
        status: true,
        payments: { select: { amountApplied: true } },
        project: { select: { name: true } },
      },
    });
    if (!target) continue;
    const pagado = target.payments.reduce((s, p) => s + p.amountApplied, 0);
    const excedente = Math.abs(nc.totalAmount) - (target.totalAmount - pagado);
    if (excedente <= 100) continue;
    excedenteTotal += excedente;
    console.log(
      `\n  NC F-${nc.folioNumber} ${d(nc.issueDate)} ${clp(Math.abs(nc.totalAmount))} · ${(nc.businessName ?? "").slice(0, 28)}`
    );
    console.log(
      `     aplicada a F-${target.folioNumber} (total ${clp(target.totalAmount)}, pagado ${clp(pagado)}, saldo ${clp(target.totalAmount - pagado)}) [${target.status}] ${target.project?.name ?? "sin obra"}`
    );
    console.log(`     EXCEDENTE QUE SE PIERDE: ${clp(excedente)}`);
  }
  console.log(`\n  >> excedente total sin rastro: ${clp(excedenteTotal)}`);

  // ── 3. Comercial Hispano: el caso concreto ──────────────────────────────
  linea("3. COMERCIAL HISPANO — folios del brief");
  for (const folio of ["854210", "150709", "877855", "149154", "868724"]) {
    const f = await prisma.invoice.findFirst({
      where: { folioNumber: folio },
      select: {
        id: true,
        folioNumber: true,
        tipoDoc: true,
        issueDate: true,
        totalAmount: true,
        status: true,
        businessName: true,
        compensationType: true,
        appliedToInvoiceId: true,
        refundBankMovementId: true,
        referenceFolioNumber: true,
        project: { select: { name: true } },
        payments: { select: { amountApplied: true } },
      },
    });
    if (!f) {
      console.log(`  F-${folio}: NO ESTÁ en la base`);
      continue;
    }
    const pagado = f.payments.reduce((s, p) => s + p.amountApplied, 0);
    console.log(
      `  F-${f.folioNumber} tipoDoc=${f.tipoDoc} ${d(f.issueDate)} ${clp(f.totalAmount).padStart(12)} [${f.status}] ${f.project?.name ?? "sin obra"}`
    );
    console.log(
      `      pagado ${clp(pagado)} · compensación=${f.compensationType ?? "—"} · aplicadaA=${f.appliedToInvoiceId ?? "—"} · refMov=${f.refundBankMovementId ?? "—"} · refFolio=${f.referenceFolioNumber ?? "—"}`
    );
  }

  // El depósito del 14-ago de $133.565
  const dep = await prisma.bankMovement.findMany({
    where: { amount: { gt: 133000, lt: 134000 } },
    select: { id: true, date: true, amount: true, description: true, status: true },
  });
  console.log(`\n  depósitos ~$133.5k:`);
  for (const m of dep)
    console.log(`     ${d(m.date)} ${clp(m.amount)} [${m.status}] ${(m.description ?? "").slice(0, 40)}`);

  // ── 4. Baseline de sobrantes sin asignar (pendiente 103) ────────────────
  linea("4. BASELINE — movimientos sin asignar (la lista que debería bajar)");
  const sinAsignar = await prisma.bankMovement.findMany({
    where: { status: "sin_asignar" },
    select: { amount: true },
  });
  console.log(
    `  sin_asignar: ${sinAsignar.length} movimientos · ${clp(
      sinAsignar.reduce((s, m) => s + Math.abs(m.amount), 0)
    )} en valor absoluto`
  );
  console.log(
    `  (de esos, ingresos: ${sinAsignar.filter((m) => m.amount > 0).length} · ${clp(
      sinAsignar.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)
    )})`
  );
  console.log(
    `  movimientos "parcial" (con sobrante): ${
      (await prisma.bankMovement.count({ where: { status: "parcial" } }))
    }`
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
