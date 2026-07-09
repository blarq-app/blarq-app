// Test de comportamiento del helper cleanupInvoicesAfterUnassign.
//
// Reproduce el escenario del bug: un "pago sin factura" (Invoice sintético
// origin "sin_respaldo" + InvoicePayment) que se desconcilia. Verifica que:
//   1) al quedar sin imputaciones, el Invoice sin_respaldo se BORRA (antes,
//      por "Editar", quedaba huérfano);
//   2) una factura NORMAL (otro origin) NO se borra — solo recalcula status.
//
// Corre contra la base VIEJA (.env por default, ep-solitary-mud). NUNCA prod.
// Crea sus propios fixtures y los limpia al final. Read-mostly + rollback.
//
// Uso: npx tsx scripts/test-cleanup-sin-respaldo.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { cleanupInvoicesAfterUnassign } from "../src/lib/banco/invoicePayments";

let ok = true;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FALLA"} — ${msg}`);
  if (!cond) ok = false;
}

async function main() {
  // Marcador de base (queremos la VIEJA, no la viva).
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Base: #64 = ${p64?.name ?? "(no existe)"} (vieja esperada ≠ "Paseo del Sena")\n`);

  const account = await prisma.bankAccount.findFirst({ select: { id: true } });
  const project = await prisma.project.findFirst({ select: { id: true, name: true } });
  const category = await prisma.costCategory.findFirst({ select: { id: true } });
  if (!account || !project || !category) {
    console.error("No hay cuenta/proyecto/categoría para armar el fixture.");
    process.exit(1);
  }

  const createdMovIds: string[] = [];
  try {
    // ── CASO 1: pago sin factura (sin_respaldo) → debe BORRARSE ──────────
    const mov1 = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date("2026-01-15"),
        description: "TEST cleanup sin_respaldo",
        amount: -123456,
        type: "cargo",
        status: "conciliado",
      },
    });
    createdMovIds.push(mov1.id);
    const invSR = await prisma.invoice.create({
      data: {
        projectId: project.id,
        categoryId: category.id,
        type: "recibida",
        tipoDoc: 1043,
        folioNumber: `SR-TEST-${mov1.id}`,
        rutReceiver: "76000000-0",
        issueDate: new Date("2026-01-15"),
        dueDate: new Date("2026-01-15"),
        netAmount: 123456,
        iva: 0,
        totalAmount: 123456,
        status: "pagada",
        paidAt: new Date("2026-01-15"),
        origin: "sin_respaldo",
        notes: "fixture test",
      },
    });
    await prisma.invoicePayment.create({
      data: { bankMovementId: mov1.id, invoiceId: invSR.id, amountApplied: 123456 },
    });

    // Simular "Editar → desasignar": borrar el pago y correr el helper real.
    await prisma.invoicePayment.deleteMany({ where: { bankMovementId: mov1.id } });
    await cleanupInvoicesAfterUnassign([invSR.id]);

    const stillThere = await prisma.invoice.findUnique({ where: { id: invSR.id } });
    check(stillThere === null, "Invoice sin_respaldo huérfano se BORRA al desconciliar");

    // ── CASO 2: factura NORMAL (otro origin) → NO debe borrarse ──────────
    const mov2 = await prisma.bankMovement.create({
      data: {
        bankAccountId: account.id,
        date: new Date("2026-01-16"),
        description: "TEST cleanup factura normal",
        amount: -50000,
        type: "cargo",
        status: "conciliado",
      },
    });
    createdMovIds.push(mov2.id);
    const invNormal = await prisma.invoice.create({
      data: {
        projectId: project.id,
        categoryId: category.id,
        type: "recibida",
        tipoDoc: 33,
        folioNumber: `NORMAL-TEST-${mov2.id}`,
        rutReceiver: "76000000-0",
        issueDate: new Date("2026-01-16"),
        dueDate: new Date("2026-01-16"),
        netAmount: 50000,
        iva: 0,
        totalAmount: 50000,
        status: "pagada",
        paidAt: new Date("2026-01-16"),
        origin: "manual",
        notes: "fixture test",
      },
    });
    await prisma.invoicePayment.create({
      data: { bankMovementId: mov2.id, invoiceId: invNormal.id, amountApplied: 50000 },
    });

    await prisma.invoicePayment.deleteMany({ where: { bankMovementId: mov2.id } });
    await cleanupInvoicesAfterUnassign([invNormal.id]);

    const normalAfter = await prisma.invoice.findUnique({
      where: { id: invNormal.id },
      select: { status: true },
    });
    check(normalAfter !== null, "Factura normal NO se borra al desconciliar");
    check(normalAfter?.status === "pendiente", "Factura normal vuelve a 'pendiente' (recompute)");

    // Limpiar el fixture normal (el sin_respaldo ya no existe).
    await prisma.invoice.deleteMany({ where: { id: invNormal.id } });
  } finally {
    // Limpiar movimientos de prueba y cualquier pago colgante.
    await prisma.invoicePayment.deleteMany({ where: { bankMovementId: { in: createdMovIds } } });
    await prisma.invoice.deleteMany({ where: { folioNumber: { startsWith: "SR-TEST-" } } });
    await prisma.invoice.deleteMany({ where: { folioNumber: { startsWith: "NORMAL-TEST-" } } });
    await prisma.bankMovement.deleteMany({ where: { id: { in: createdMovIds } } });
  }

  console.log(`\n${ok ? "TODO VERDE ✓" : "HAY FALLAS ✗"}`);
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
