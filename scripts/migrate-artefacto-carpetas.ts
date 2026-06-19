/**
 * Migración "carpetas a mano" del catálogo de artefactos (2026-06-19).
 *
 * Antes los subgrupos del catálogo se calculaban de line+finish (editar la
 * línea de un artefacto lo separaba/reagrupaba solo). Ahora la agrupación es una
 * CARPETA manual (columna ArtefactoCatalog.subgroup) que MJ arma a gusto, y
 * line/finish quedan como etiquetas que ya NO deciden el grupo.
 *
 * Esta migración:
 *   1) Agrega la columna ArtefactoCatalog."subgroup" (si no está).
 *   2) Siembra la carpeta de cada artefacto a partir de su line+finish actual,
 *      para que el día 1 NADA se mueva (la organización de hoy queda congelada
 *      como carpetas). Solo toca filas con subgroup NULL.
 *   3) Reestructura ArtefactoSubgroupOrder: pasa de (line, finish) a (subgroup).
 *      La tabla está vacía (recién creada en #176), así que es seguro.
 *
 * Idempotente: se puede correr varias veces. El paso 2 solo afecta filas con
 * subgroup NULL, así que no pisa "sin carpeta" puestos a mano después.
 *
 * NO usamos `prisma db push` (ver CLAUDE.md): solo ALTER/UPDATE puntuales.
 *
 * Uso dev:  npx tsx scripts/migrate-artefacto-carpetas.ts
 * Uso prod: DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/migrate-artefacto-carpetas.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1) Columna subgroup en el catálogo.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ArtefactoCatalog" ADD COLUMN IF NOT EXISTS "subgroup" TEXT;`
  );

  // 2) Sembrar carpeta = "línea · color" (lo que hoy define el subgrupo). Si no
  //    hay ni línea ni color, queda NULL ("sin carpeta"). CONCAT_WS ignora los
  //    nulos; NULLIF(TRIM(...), '') convierte vacío en null. Solo filas NULL.
  const seeded = await prisma.$executeRawUnsafe(`
    UPDATE "ArtefactoCatalog"
    SET "subgroup" = NULLIF(
      CONCAT_WS(' · ',
        NULLIF(TRIM("line"), ''),
        NULLIF(TRIM("finish"), '')
      ), ''
    )
    WHERE "subgroup" IS NULL;
  `);

  // 3) Reestructurar ArtefactoSubgroupOrder a (subcategory, tag, subgroup).
  //    Tabla vacía → seguro. Idempotente: IF EXISTS / IF NOT EXISTS.
  // 3a) Tabla con la forma NUEVA para bases frescas.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ArtefactoSubgroupOrder" (
      "id" TEXT NOT NULL,
      "subcategory" TEXT NOT NULL,
      "tag" TEXT NOT NULL,
      "subgroup" TEXT NOT NULL DEFAULT '',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ArtefactoSubgroupOrder_pkey" PRIMARY KEY ("id")
    );
  `);
  // 3b) Si venía de la forma vieja (line/finish), converger. CRÍTICO: mapear el
  //     orden viejo (que se identificaba por line+finish) al NOMBRE de carpeta
  //     ANTES de soltar esas columnas — si no, se pierde el orden manual de los
  //     subgrupos. El nombre de carpeta se arma igual que el sembrado del
  //     catálogo ("línea · color"), así el orden viejo cae sobre la carpeta que
  //     corresponde.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ArtefactoSubgroupOrder" ADD COLUMN IF NOT EXISTS "subgroup" TEXT NOT NULL DEFAULT '';`
  );
  const hasLine = (
    await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'ArtefactoSubgroupOrder' AND column_name = 'line'`
    )
  ).length > 0;
  if (hasLine) {
    await prisma.$executeRawUnsafe(`
      UPDATE "ArtefactoSubgroupOrder"
      SET "subgroup" = COALESCE(
        NULLIF(CONCAT_WS(' · ', NULLIF(TRIM("line"), ''), NULLIF(TRIM("finish"), '')), ''),
        ''
      );
    `);
  }
  // Dedup defensivo: si quedaran dos filas con la misma (subcategory, tag,
  // subgroup) — p.ej. una base a medio migrar con varias filas en "" — dejar una
  // sola (la de menor sortOrder) para poder crear el índice único.
  await prisma.$executeRawUnsafe(`
    DELETE FROM "ArtefactoSubgroupOrder" a
    USING "ArtefactoSubgroupOrder" b
    WHERE a."subcategory" = b."subcategory"
      AND a."tag" = b."tag"
      AND a."subgroup" = b."subgroup"
      AND (a."sortOrder" > b."sortOrder"
           OR (a."sortOrder" = b."sortOrder" AND a."id" > b."id"));
  `);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ArtefactoSubgroupOrder" DROP COLUMN IF EXISTS "line";`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ArtefactoSubgroupOrder" DROP COLUMN IF EXISTS "finish";`
  );
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "ArtefactoSubgroupOrder_subcategory_tag_line_finish_key";`
  );
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ArtefactoSubgroupOrder_subcategory_tag_subgroup_key"
      ON "ArtefactoSubgroupOrder"("subcategory", "tag", "subgroup");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ArtefactoSubgroupOrder_subcategory_tag_sortOrder_idx"
      ON "ArtefactoSubgroupOrder"("subcategory", "tag", "sortOrder");
  `);

  const conCarpeta = await prisma.artefactoCatalog.count({
    where: { subgroup: { not: null } },
  });
  const sinCarpeta = await prisma.artefactoCatalog.count({
    where: { subgroup: null },
  });
  console.log(
    `Migración OK. Filas tocadas en este corrida (paso 2): ${seeded}. ` +
      `Catálogo: ${conCarpeta} con carpeta, ${sinCarpeta} sin carpeta.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
