// Busca movimientos conciliados a más de una factura, para verificar en
// pantalla el desplegable de la columna Respaldo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1];
  console.log("BASE:", host);

  const movs = await prisma.bankMovement.findMany({
    include: { payments: { include: { invoice: { select: { folioNumber: true } } } } },
    orderBy: { date: "desc" },
    take: 500,
  });
  const multi = movs.filter((m) => m.payments.length > 1);
  console.log(`movimientos leídos: ${movs.length} · con >1 pago: ${multi.length}`);
  for (const m of multi.slice(0, 10)) {
    console.log(
      `  ${m.id} · ${m.date.toISOString().slice(0, 10)} · ${m.payments.length} pagos · ${m.description.slice(0, 40)}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
