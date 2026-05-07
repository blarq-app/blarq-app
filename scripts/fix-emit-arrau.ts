import { prisma } from "../src/lib/prisma";

async function main() {
  const project = await prisma.project.findFirst({ where: { name: { contains: "Arrau" } } });
  if (!project) return;

  // 151 → pagada (saldo $0 según Maxxa)
  await prisma.invoice.updateMany({
    where: { projectId: project.id, folioNumber: "151", type: "emitida" },
    data: { status: "pagada", paidAt: new Date("2026-02-18T12:00:00-03:00") },
  });
  console.log("✓ 151 → pagada");

  // 163 → parcial. Necesita InvoicePayment para que paidOf devuelva
  // $14M y remainingOf $1.279.426. Como InvoicePayment requiere
  // bankMovementId, creo un BankMovement ficticio en cualquier cuenta
  // BLARQ existente. En prod este se reemplaza al importar los movs reales.
  const account = await prisma.bankAccount.findFirst({ orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("No hay BankAccount en BD");

  const inv163 = await prisma.invoice.findFirst({
    where: { projectId: project.id, folioNumber: "163", type: "emitida" },
    select: { id: true, totalAmount: true, payments: { select: { id: true } } },
  });
  if (!inv163) return;

  if (inv163.payments.length === 0) {
    const bm = await prisma.bankMovement.create({
      data: {
        accountId: account.id,
        date: new Date("2026-04-15T12:00:00-03:00"),
        description: "Pago parcial Pía Garcés folio 163 (registro manual dev)",
        amount: 14_000_000,
        currency: "CLP",
        movementType: "ingreso",
        status: "completo",
        externalRef: `manual-arrau-163-${Date.now()}`,
      },
    });
    await prisma.invoicePayment.create({
      data: { bankMovementId: bm.id, invoiceId: inv163.id, amountApplied: 14_000_000 },
    });
    await prisma.invoice.update({
      where: { id: inv163.id },
      data: { status: "parcial" },
    });
    console.log(`✓ 163 → parcial (pagado $14.000.000, falta $${(15_279_426 - 14_000_000).toLocaleString("es-CL")})`);
  } else {
    console.log("⚠ 163 ya tiene payments. Skip.");
  }

  await prisma.$disconnect();
}
main();
