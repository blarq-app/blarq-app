/**
 * Crea la tabla ArtefactoSubgroupOrder (si no existe). Guarda el orden manual
 * de los subgrupos (línea + color) dentro de cada tipo del catálogo de
 * artefactos. No siembra nada: los subgrupos sin fila caen a orden alfabético.
 *
 * Idempotente: se puede correr varias veces. Sirve para dev y para prod.
 *
 * NO usamos `prisma db push` (ver CLAUDE.md): crea SOLO esta tabla nueva, sin
 * tocar nada más. Patrón igual a scripts/setup-artefacto-tipos.ts.
 *
 * Uso dev:  npx tsx scripts/setup-artefacto-subgroup-order.ts
 * Uso prod: DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/setup-artefacto-subgroup-order.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Tabla + índices (idempotente).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ArtefactoSubgroupOrder" (
      "id" TEXT NOT NULL,
      "subcategory" TEXT NOT NULL,
      "tag" TEXT NOT NULL,
      "line" TEXT NOT NULL,
      "finish" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ArtefactoSubgroupOrder_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ArtefactoSubgroupOrder_subcategory_tag_line_finish_key"
      ON "ArtefactoSubgroupOrder"("subcategory", "tag", "line", "finish");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ArtefactoSubgroupOrder_subcategory_tag_sortOrder_idx"
      ON "ArtefactoSubgroupOrder"("subcategory", "tag", "sortOrder");
  `);

  const total = await prisma.artefactoSubgroupOrder.count();
  console.log(`Tabla ArtefactoSubgroupOrder lista. Filas de orden: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
