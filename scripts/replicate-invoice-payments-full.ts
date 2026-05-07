// Variante "full" de replicate-invoice-payments-dev-to-prod.
//
// El script original asumía que los BankMovement de prod ya tenían
// status="conciliado" (caso del cutover de la ronda 11). Después de
// nuevas asignaciones manuales y auto-conciliados en dev (ronda 13),
// esa premisa ya no aplica: prod tiene los movimientos como
// "pendiente" y no tiene los InvoicePayment.
//
// Esta variante itera desde TODOS los InvoicePayment de dev y crea
// el equivalente en prod si no existe. También actualiza el status
// del BankMovement en prod a "conciliado" o "parcial" según el monto.
//
// Match: por hash estable (accountNumber + fecha + monto + externalRef)
// para BankMovement y (folio + tipoDoc + rutIssuer) para Invoice.
//
// Uso:
//   DATABASE_URL='...dev...' DATABASE_URL_PROD='...prod...' \
//     npx tsx scripts/replicate-invoice-payments-full.ts            # dry-run
//   ... npx tsx scripts/replicate-invoice-payments-full.ts --apply

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const DEV_URL = process.env.DATABASE_URL;
const PROD_URL = process.env.DATABASE_URL_PROD;

if (!DEV_URL || !PROD_URL) { console.error("Faltan DATABASE_URL / DATABASE_URL_PROD"); process.exit(1); }
if (!/ep-solitary-mud/.test(DEV_URL)) { console.error("DATABASE_URL no parece dev"); process.exit(1); }
if (!/ep-shy-morning/.test(PROD_URL)) { console.error("DATABASE_URL_PROD no parece prod"); process.exit(1); }

const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } });
const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } });

function movKey(m: {
  date: Date;
  amount: number;
  externalRef: string | null;
  description: string;
  accountNumber: string;
}): string {
  const fecha = m.date.toISOString().slice(0, 10);
  const ext = m.externalRef ?? "";
  const desc = ext ? "" : m.description.trim().slice(0, 60);
  return [m.accountNumber, fecha, Math.round(m.amount), ext, desc].join("|");
}

function invKey(i: {
  folioNumber: string | null;
  tipoDoc: number | null;
  rutIssuer: string | null;
}): string {
  return `${i.tipoDoc ?? ""}|${i.folioNumber ?? ""}|${i.rutIssuer ?? ""}`;
}

async function main() {
  console.log(`MODO: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // 1. Todos los InvoicePayments de dev
  const devPayments = await dev.invoicePayment.findMany({
    include: {
      bankMovement: { include: { bankAccount: { select: { accountNumber: true } } } },
      invoice: { select: { folioNumber: true, tipoDoc: true, rutIssuer: true } },
    },
  });
  console.log(`\nDev: ${devPayments.length} InvoicePayments`);

  // 2. Indexar movimientos de prod por hash
  const prodMovs = await prod.bankMovement.findMany({
    include: { bankAccount: { select: { accountNumber: true } }, payments: true },
  });
  const prodMovByKey = new Map<string, typeof prodMovs[number]>();
  for (const m of prodMovs) {
    prodMovByKey.set(movKey({
      date: m.date,
      amount: m.amount,
      externalRef: m.externalRef,
      description: m.description,
      accountNumber: m.bankAccount.accountNumber,
    }), m);
  }
  console.log(`Prod: ${prodMovs.length} BankMovements`);

  // 3. Indexar facturas de prod por invKey
  const prodInvs = await prod.invoice.findMany({
    select: { id: true, folioNumber: true, tipoDoc: true, rutIssuer: true, totalAmount: true },
  });
  const prodInvByKey = new Map<string, typeof prodInvs[number]>();
  for (const inv of prodInvs) prodInvByKey.set(invKey(inv), inv);
  console.log(`Prod: ${prodInvs.length} Invoices\n`);

  // 4. Para cada devPayment, decidir si hay que crear en prod
  let aCrear = 0;
  let yaExisten = 0;
  let movFaltanteProd = 0;
  let invFaltanteProd = 0;
  const movsACambiarStatus = new Set<string>(); // ids de movs prod cuyos payments creé

  for (const p of devPayments) {
    const mk = movKey({
      date: p.bankMovement.date,
      amount: p.bankMovement.amount,
      externalRef: p.bankMovement.externalRef,
      description: p.bankMovement.description,
      accountNumber: p.bankMovement.bankAccount.accountNumber,
    });
    const prodMov = prodMovByKey.get(mk);
    if (!prodMov) { movFaltanteProd++; continue; }

    const ik = invKey(p.invoice);
    const prodInv = prodInvByKey.get(ik);
    if (!prodInv) { invFaltanteProd++; continue; }

    // ¿Ya existe el payment?
    const existing = prodMov.payments.find((pp) => pp.invoiceId === prodInv.id);
    if (existing) { yaExisten++; continue; }

    aCrear++;
    if (APPLY) {
      try {
        await prod.invoicePayment.create({
          data: {
            bankMovementId: prodMov.id,
            invoiceId: prodInv.id,
            amountApplied: p.amountApplied,
          },
        });
        movsACambiarStatus.add(prodMov.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unique constraint")) {
          // race / re-run, OK
        } else {
          console.error(`  ERROR ${ik}:`, msg);
        }
      }
    }
  }

  console.log(`A crear:                ${aCrear}`);
  console.log(`Ya existían:            ${yaExisten}`);
  console.log(`Mov no en prod:         ${movFaltanteProd}`);
  console.log(`Invoice no en prod:     ${invFaltanteProd}`);

  // 5. Recalcular status de BankMovements modificados
  if (APPLY && movsACambiarStatus.size > 0) {
    console.log(`\nRecalculando status de ${movsACambiarStatus.size} movs en prod…`);
    let conciliados = 0;
    let parciales = 0;
    for (const movId of movsACambiarStatus) {
      const m = await prod.bankMovement.findUnique({
        where: { id: movId },
        include: { payments: true },
      });
      if (!m) continue;
      const totalAplicado = m.payments.reduce((s, p) => s + p.amountApplied, 0);
      const monto = Math.abs(m.amount);
      // Conciliado si suma cubre el monto, parcial si no
      const newStatus = Math.abs(totalAplicado - monto) < 1 ? "conciliado" : "parcial";
      await prod.bankMovement.update({
        where: { id: movId },
        data: { status: newStatus },
      });
      if (newStatus === "conciliado") conciliados++;
      else parciales++;
    }
    console.log(`  → conciliado: ${conciliados}`);
    console.log(`  → parcial:    ${parciales}`);
  }

  if (!APPLY) console.log(`\nDRY-RUN. Re-correr con --apply.`);
  await dev.$disconnect();
  await prod.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
