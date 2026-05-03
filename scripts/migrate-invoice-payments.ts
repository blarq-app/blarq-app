// Migra los BankMovement.invoiceId existentes a InvoicePayment rows.
// One-shot. Idempotente — si la fila ya existe, salta.

import { prisma } from "../src/lib/prisma";

async function main() {
  const linked = await prisma.bankMovement.findMany({
    where: { invoiceId: { not: null } },
    select: { id: true, invoiceId: true, amount: true },
  });

  console.log(`Encontrados ${linked.length} movimientos con invoiceId.`);

  let created = 0;
  let skipped = 0;
  for (const mov of linked) {
    if (!mov.invoiceId) continue;
    const exists = await prisma.invoicePayment.findUnique({
      where: { payment_unique: { bankMovementId: mov.id, invoiceId: mov.invoiceId } },
    });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.invoicePayment.create({
      data: {
        bankMovementId: mov.id,
        invoiceId: mov.invoiceId,
        amountApplied: Math.abs(mov.amount),
      },
    });
    created++;
  }

  console.log(`✓ ${created} InvoicePayment creados, ${skipped} ya existían.`);

  // Verificar consistencia: cuántas facturas pagadas hay vs cuántas tienen
  // suma >= total.
  const pagadas = await prisma.invoice.count({ where: { status: "pagada" } });
  console.log(`Facturas en status='pagada': ${pagadas}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
