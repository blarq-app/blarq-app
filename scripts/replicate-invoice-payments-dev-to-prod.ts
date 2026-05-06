// Replica los InvoicePayment desde dev hacia prod.
//
// Contexto: el cutover de la "ronda 11" copió los BankMovement (con su
// status="conciliado") y los Invoice de dev → prod, pero los registros
// InvoicePayment (link banco↔factura) NO se replicaron porque sus IDs
// son específicos de la branch dev. Resultado: en prod, los movimientos
// marcados "conciliado" no muestran la factura asociada al expandirlos.
//
// Este script matchea movimientos y facturas entre dev y prod por campos
// estables (no por ID), y crea los InvoicePayment faltantes en prod.
//
// Uso:
//   DATABASE_URL_PROD="<url-prod>" npx tsx scripts/replicate-invoice-payments-dev-to-prod.ts
//   DATABASE_URL_PROD="<url-prod>" npx tsx scripts/replicate-invoice-payments-dev-to-prod.ts --apply
//
// Sin --apply corre en dry-run y no escribe nada.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

const DEV_URL = process.env.DATABASE_URL;
const PROD_URL = process.env.DATABASE_URL_PROD;

if (!DEV_URL || !PROD_URL) {
  console.error("Faltan DATABASE_URL (dev) o DATABASE_URL_PROD en el entorno.");
  process.exit(1);
}

if (!/ep-solitary-mud/.test(DEV_URL)) {
  console.error("DATABASE_URL no parece dev (espera ep-solitary-mud).");
  process.exit(1);
}

if (!/ep-shy-morning/.test(PROD_URL)) {
  console.error("DATABASE_URL_PROD no parece prod (espera ep-shy-morning).");
  process.exit(1);
}

const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } });
const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } });

// Hash estable de un BankMovement — usamos el accountNumber del banco (no el
// id de BankAccount, que difiere entre branches), la fecha (yyyy-mm-dd para
// tolerar timezones), monto y externalRef. Si no hay externalRef, agregamos
// description como tiebreaker.
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

// Hash estable de Invoice — folioNumber + tipoDoc + rutIssuer son únicos en SII.
function invKey(i: {
  folioNumber: string | null;
  tipoDoc: number | null;
  rutIssuer: string | null;
}): string {
  return `${i.tipoDoc ?? ""}|${i.folioNumber ?? ""}|${i.rutIssuer ?? ""}`;
}

async function main() {
  console.log(`MODO: ${APPLY ? "APPLY (escribe en prod)" : "DRY-RUN (no escribe)"}`);
  console.log(`DEV : ${DEV_URL!.slice(0, 60)}…`);
  console.log(`PROD: ${PROD_URL!.slice(0, 60)}…\n`);

  // 1. Cargar todos los InvoicePayment de dev junto a su BankMovement,
  //    BankAccount.accountNumber e Invoice (folio/tipoDoc/emisorRut).
  console.log("→ Leyendo InvoicePayment de dev…");
  const devPayments = await dev.invoicePayment.findMany({
    include: {
      bankMovement: {
        include: { bankAccount: { select: { accountNumber: true } } },
      },
      invoice: {
        select: { folioNumber: true, tipoDoc: true, rutIssuer: true },
      },
    },
  });
  console.log(`  ${devPayments.length} payments en dev.`);

  // 2. Cargar BankMovements de prod con status=conciliado y SIN payment.
  //    Esos son los candidatos a re-conciliar.
  console.log("\n→ Leyendo BankMovement conciliados sin payment en prod…");
  const prodMovsHuerfanos = await prod.bankMovement.findMany({
    where: { status: "conciliado", payments: { none: {} } },
    include: { bankAccount: { select: { accountNumber: true } } },
  });
  console.log(`  ${prodMovsHuerfanos.length} movimientos huérfanos en prod.`);

  if (prodMovsHuerfanos.length === 0) {
    console.log("\nNada que hacer.");
    return;
  }

  // 3. Index dev movs por hash → lista de payments asociados.
  const devByMovKey = new Map<string, typeof devPayments>();
  for (const p of devPayments) {
    const key = movKey({
      date: p.bankMovement.date,
      amount: p.bankMovement.amount,
      externalRef: p.bankMovement.externalRef,
      description: p.bankMovement.description,
      accountNumber: p.bankMovement.bankAccount.accountNumber,
    });
    if (!devByMovKey.has(key)) devByMovKey.set(key, []);
    devByMovKey.get(key)!.push(p);
  }

  // 4. Cargar invoices de prod indexadas por hash, para resolver invoiceId.
  console.log("\n→ Indexando facturas de prod…");
  const prodInvs = await prod.invoice.findMany({
    select: { id: true, folioNumber: true, tipoDoc: true, rutIssuer: true },
  });
  const prodInvByKey = new Map<string, string>();
  for (const inv of prodInvs) {
    prodInvByKey.set(invKey(inv), inv.id);
  }
  console.log(`  ${prodInvs.length} facturas indexadas.`);

  // 5. Para cada mov huérfano en prod, encontrar payments equivalentes en dev
  //    y mapear a invoices de prod.
  const aCrear: Array<{
    bankMovementId: string;
    invoiceId: string;
    amountApplied: number;
    devMovDescription: string;
    invoiceLabel: string;
  }> = [];
  const sinMatchEnDev: Array<{ id: string; date: Date; amount: number; description: string }> = [];
  const invoiceFaltanteEnProd: Array<{
    movDesc: string;
    invKey: string;
  }> = [];

  for (const m of prodMovsHuerfanos) {
    const key = movKey({
      date: m.date,
      amount: m.amount,
      externalRef: m.externalRef,
      description: m.description,
      accountNumber: m.bankAccount.accountNumber,
    });
    const matched = devByMovKey.get(key);
    if (!matched || matched.length === 0) {
      sinMatchEnDev.push({
        id: m.id,
        date: m.date,
        amount: m.amount,
        description: m.description,
      });
      continue;
    }
    for (const p of matched) {
      const ik = invKey(p.invoice);
      const prodInvoiceId = prodInvByKey.get(ik);
      if (!prodInvoiceId) {
        invoiceFaltanteEnProd.push({
          movDesc: m.description.slice(0, 60),
          invKey: ik,
        });
        continue;
      }
      aCrear.push({
        bankMovementId: m.id,
        invoiceId: prodInvoiceId,
        amountApplied: p.amountApplied,
        devMovDescription: m.description.slice(0, 50),
        invoiceLabel: ik,
      });
    }
  }

  // 6. Reporte
  console.log(`\n=== PLAN ===`);
  console.log(`Movs prod a re-conciliar           : ${prodMovsHuerfanos.length}`);
  console.log(`Sin match en dev                   : ${sinMatchEnDev.length}`);
  console.log(`Match dev pero invoice no en prod  : ${invoiceFaltanteEnProd.length}`);
  console.log(`InvoicePayment a crear en prod     : ${aCrear.length}`);

  if (sinMatchEnDev.length > 0) {
    console.log(`\nMuestra de movs SIN MATCH en dev (primeros 5):`);
    for (const m of sinMatchEnDev.slice(0, 5)) {
      console.log(
        `  · ${m.date.toISOString().slice(0, 10)} · $${m.amount.toLocaleString()} · ${m.description.slice(0, 60)}`
      );
    }
  }

  if (invoiceFaltanteEnProd.length > 0) {
    console.log(`\nFacturas referenciadas en dev pero no en prod (primeros 5):`);
    for (const f of invoiceFaltanteEnProd.slice(0, 5)) {
      console.log(`  · invKey=${f.invKey}  ← mov: ${f.movDesc}`);
    }
  }

  if (aCrear.length > 0) {
    console.log(`\nMuestra de payments a crear (primeros 3):`);
    for (const c of aCrear.slice(0, 3)) {
      console.log(
        `  · ${c.devMovDescription.padEnd(45)} → invoice ${c.invoiceLabel}  (aplica $${c.amountApplied.toLocaleString()})`
      );
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN. Para aplicar:`);
    console.log(
      `  DATABASE_URL_PROD="..." npx tsx scripts/replicate-invoice-payments-dev-to-prod.ts --apply`
    );
    return;
  }

  // 7. Aplicar
  console.log(`\n→ Creando ${aCrear.length} InvoicePayment en PROD…`);
  let creados = 0;
  let conflictoUnique = 0;
  for (const c of aCrear) {
    try {
      await prod.invoicePayment.create({
        data: {
          bankMovementId: c.bankMovementId,
          invoiceId: c.invoiceId,
          amountApplied: c.amountApplied,
        },
      });
      creados++;
    } catch (e: unknown) {
      // Si el payment ya existe (race o re-run), no es error fatal.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique constraint")) {
        conflictoUnique++;
      } else {
        console.error(`  ERROR creando payment ${c.invoiceLabel}:`, msg);
      }
    }
  }
  console.log(`\n  Creados: ${creados}`);
  console.log(`  Ya existían (skipped): ${conflictoUnique}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await dev.$disconnect();
    await prod.$disconnect();
  });
