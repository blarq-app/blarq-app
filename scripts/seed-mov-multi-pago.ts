/**
 * Siembra en la base DEV un movimiento bancario conciliado a MUCHAS facturas,
 * para poder ver en pantalla el desplegable de la columna Respaldo.
 *
 * Replica el caso real de MJ: un reembolso de tarjeta repartido en ~25
 * facturas de proveedores, de varias obras. La base dev no tiene ningún
 * movimiento así (tiene uno solo con 2 pagos), así que se arma acá.
 *
 * NO toca la base viva: aborta si el host no es el de dev.
 *
 * Uso:
 *   npx tsx scripts/seed-mov-multi-pago.ts --crear
 *   npx tsx scripts/seed-mov-multi-pago.ts --borrar
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MARCA = "[PRUEBA-DETALLE-PAGOS] Reembolso tarjeta CMR";

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "";
  if (!host.includes("ep-solitary-mud")) {
    throw new Error(`Esto solo corre contra DEV. Host actual: ${host}`);
  }
  console.log("BASE (dev):", host);

  // Borrar siempre primero — así re-correr con --crear no deja duplicados.
  const viejos = await prisma.bankMovement.findMany({
    where: { description: MARCA },
    select: { id: true },
  });
  if (viejos.length > 0) {
    const ids = viejos.map((v) => v.id);
    const { count } = await prisma.invoicePayment.deleteMany({
      where: { bankMovementId: { in: ids } },
    });
    await prisma.bankMovement.deleteMany({ where: { id: { in: ids } } });
    console.log(`borrado: ${viejos.length} movimiento(s) de prueba y ${count} pago(s)`);
  }

  if (process.argv.includes("--borrar")) return;
  if (!process.argv.includes("--crear")) {
    console.log("nada que hacer (pasá --crear o --borrar)");
    return;
  }

  // 25 facturas recibidas reales de dev, priorizando las que tienen obra
  // asignada — la gracia del desplegable es ver a qué obra fue cada una.
  const facturas = await prisma.invoice.findMany({
    where: { type: "recibida", projectId: { not: null }, totalAmount: { gt: 0 } },
    select: { id: true, totalAmount: true, folioNumber: true },
    orderBy: { issueDate: "desc" },
    take: 25,
  });
  if (facturas.length < 2) throw new Error("dev no tiene facturas suficientes");

  const cuenta = await prisma.bankAccount.findFirst({ orderBy: { role: "asc" } });
  if (!cuenta) throw new Error("dev no tiene cuentas bancarias");

  // El movimiento tiene que cubrir la suma imputada, si no queda "sobreimputado"
  // (rojo) y eso no es lo que se está verificando.
  const total = facturas.reduce((s, f) => s + f.totalAmount, 0);

  const mov = await prisma.bankMovement.create({
    data: {
      bankAccountId: cuenta.id,
      date: new Date("2026-07-15T00:00:00.000Z"),
      description: MARCA,
      amount: -total,
      type: "cargo",
      status: "conciliado",
      counterpartyName: "PRUEBA",
    },
  });

  for (const f of facturas) {
    await prisma.invoicePayment.create({
      data: {
        invoiceId: f.id,
        bankMovementId: mov.id,
        amountApplied: f.totalAmount,
      },
    });
  }

  console.log(
    `creado ${mov.id} · ${facturas.length} pagos · total ${Math.round(total).toLocaleString("es-CL")}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
