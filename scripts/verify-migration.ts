// Verifica que la data migrada a Postgres no perdió valores en el camino.
// No solo cuenta — compara aggregations (sumas, agrupaciones) entre SQLite
// y Postgres. Si algo no coincide, hay un bug en el script de migración.
//
// Uso: npx tsx scripts/verify-migration.ts

import { PrismaClient as SqliteClient } from "@prisma/client";
import { PrismaClient as PostgresClient } from "@prisma/client-postgres";

if (!process.env.POSTGRES_URL) {
  console.error("❌ Falta POSTGRES_URL en .env");
  process.exit(1);
}

const sqlite = new SqliteClient();
const pg = new PostgresClient({
  datasources: { db: { url: process.env.POSTGRES_URL } },
});

let mismatches = 0;
function check(label: string, sqliteVal: unknown, pgVal: unknown) {
  const ok = JSON.stringify(sqliteVal) === JSON.stringify(pgVal);
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`    sqlite: ${JSON.stringify(sqliteVal)}`);
    console.log(`    postgres: ${JSON.stringify(pgVal)}`);
    mismatches++;
  }
}

async function main() {
  console.log("Verificando integridad de la migración...\n");

  // 1. Suma totalAmount de invoices por type
  const sqInvSum = await sqlite.invoice.groupBy({
    by: ["type"],
    _sum: { totalAmount: true, netAmount: true },
    orderBy: { type: "asc" },
  });
  const pgInvSum = await pg.invoice.groupBy({
    by: ["type"],
    _sum: { totalAmount: true, netAmount: true },
    orderBy: { type: "asc" },
  });
  check("Σ invoice por type (totalAmount + netAmount)", sqInvSum, pgInvSum);

  // 2. BankMovement amount sum por status
  const sqBmSum = await sqlite.bankMovement.groupBy({
    by: ["status"],
    _sum: { amount: true },
    orderBy: { status: "asc" },
  });
  const pgBmSum = await pg.bankMovement.groupBy({
    by: ["status"],
    _sum: { amount: true },
    orderBy: { status: "asc" },
  });
  check("Σ bankMovement amount por status", sqBmSum, pgBmSum);

  // 3. InvoicePayment amountApplied sum
  const sqIp = await sqlite.invoicePayment.aggregate({ _sum: { amountApplied: true } });
  const pgIp = await pg.invoicePayment.aggregate({ _sum: { amountApplied: true } });
  check("Σ invoicePayment.amountApplied", sqIp, pgIp);

  // 4. Project counts por status
  const sqProj = await sqlite.project.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { status: "asc" },
  });
  const pgProj = await pg.project.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { status: "asc" },
  });
  check("Project count por status", sqProj, pgProj);

  // 5. CostCategory parents preservados (self-ref check)
  const sqCats = await sqlite.costCategory.findMany({
    where: { parentId: { not: null } },
    select: { id: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });
  const pgCats = await pg.costCategory.findMany({
    where: { parentId: { not: null } },
    select: { id: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });
  check("CostCategory subcategorías (self-ref preservada)", sqCats.length, pgCats.length);
  // Sample-check 3 randoms para verificar que el parentId apunta al mismo padre
  for (let i = 0; i < Math.min(3, sqCats.length); i++) {
    check(
      `  CostCategory[${i}] (${sqCats[i].name}) parentId`,
      sqCats[i].parentId,
      pgCats[i].parentId
    );
  }

  // 6. BankMovement internal transfers preservados
  const sqIt = await sqlite.bankMovement.count({
    where: { internalTransferToId: { not: null } },
  });
  const pgIt = await pg.bankMovement.count({
    where: { internalTransferToId: { not: null } },
  });
  check("BankMovement con internalTransferToId no-null", sqIt, pgIt);

  // 7. Sample concreto: un invoice con todos sus campos
  const sqInv = await sqlite.invoice.findFirst({
    where: { type: "recibida", businessName: { contains: "SODIMAC" } },
    orderBy: { issueDate: "desc" },
  });
  if (sqInv) {
    const pgInv = await pg.invoice.findUnique({ where: { id: sqInv.id } });
    check("Invoice Sodimac sample (todos los campos)", sqInv, pgInv);
  }

  // 8. Users — el dato más sensible (passwords hashed)
  const sqUsers = await sqlite.user.findMany({ orderBy: { email: "asc" } });
  const pgUsers = await pg.user.findMany({ orderBy: { email: "asc" } });
  check("Users completos (incluyendo password hash)", sqUsers, pgUsers);

  console.log(`\n${"─".repeat(50)}`);
  if (mismatches === 0) {
    console.log("✅ Migración VERIFICADA — todos los aggregates y muestras coinciden.");
  } else {
    console.log(`❌ ${mismatches} mismatches detectados. Revisar arriba.`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await sqlite.$disconnect();
    await pg.$disconnect();
  });
