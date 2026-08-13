/**
 * Migración idempotente del pendiente 155 (condiciones editables del PDF).
 *
 * Va por SQL a mano y no por `prisma db push` a propósito: las bases arrastran
 * drift de otras ramas (columnas que el schema ya no tiene), y un push las
 * dropearía de paso. Esto agrega SOLO lo nuestro y se puede correr dos veces.
 *
 *   npx tsx scripts/migrar-condiciones-schema.ts            → base de .env
 *   npx tsx scripts/migrar-condiciones-schema.ts .env.prod  → base viva
 */
import { config } from "dotenv";

const envPath = process.argv[2] || ".env";
config({ path: envPath, override: true });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`env: ${envPath}`);
  console.log(`host: ${host}`);

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "BudgetVersion" ADD COLUMN IF NOT EXISTS "conditions" JSONB`
  );
  console.log('· BudgetVersion."conditions" listo');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ConditionTemplate" (
      "id"        TEXT NOT NULL,
      "type"      TEXT NOT NULL,
      "items"     JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "ConditionTemplate_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ConditionTemplate_type_key" ON "ConditionTemplate"("type")`
  );
  console.log("· ConditionTemplate listo");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
