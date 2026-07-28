// Snapshot de los status de TODOS los movimientos bancarios (id → status).
// Pre/post del cambio "fuente única del status" para verificar que probar
// los flujos en dev no deja ningún movimiento con el estado corrido.
//
//   npx tsx scripts/diag-snapshot-status-movs.ts > pre.txt
//   ... prueba e2e + limpieza ...
//   npx tsx scripts/diag-snapshot-status-movs.ts > post.txt
//   diff pre.txt post.txt

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const grouped = await prisma.bankMovement.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("== conteo por status ==");
  for (const g of grouped.sort((a, b) => a.status.localeCompare(b.status))) {
    console.log(`${g.status}\t${g._count._all}\t${Math.round(g._sum.amount ?? 0)}`);
  }
  console.log("== detalle id→status ==");
  const movs = await prisma.bankMovement.findMany({
    select: { id: true, status: true, category: true },
    orderBy: { id: "asc" },
  });
  for (const m of movs) console.log(`${m.id}\t${m.status}\t${m.category ?? "-"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
