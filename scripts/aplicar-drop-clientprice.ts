/**
 * Aplica el DROP de ArtefactoCatalog.clientPrice a la base viva.
 *
 * Va DESPUÉS del deploy del PR #357 — el código viejo todavía seleccionaba la
 * columna. Antes de correrlo tiene que existir el respaldo
 * (scripts/backup-catalogo-clientprice.ts).
 *
 * Verifica que el respaldo exista, cuenta las filas, aplica el ALTER y
 * comprueba que la app siga leyendo el catálogo bien.
 *
 *   npx tsx scripts/aplicar-drop-clientprice.ts                 # solo chequea
 *   npx tsx scripts/aplicar-drop-clientprice.ts --aplicar
 */
import { readFileSync, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APLICAR = process.argv.includes("--aplicar");
const RESPALDO =
  "/Users/mjblanco/Desktop/blarq-app/backups/backup-catalogo-clientprice-2026-07-31.json";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("HOST:", HOST);
  console.log("MODO:", APLICAR ? "APLICAR" : "solo chequeo");

  if (!existsSync(RESPALDO)) {
    throw new Error(
      `Falta el respaldo (${RESPALDO}). Corré antes: npx tsx scripts/backup-catalogo-clientprice.ts`
    );
  }
  const resp = JSON.parse(readFileSync(RESPALDO, "utf8"));
  console.log(`Respaldo OK: ${resp.conValor} productos con valor guardado.`);

  const existe = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM information_schema.columns
     WHERE table_name = 'ArtefactoCatalog' AND column_name = 'clientPrice'`
  );
  const hayColumna = Number(existe[0].count) > 0;
  console.log("¿La columna existe todavía?", hayColumna ? "sí" : "no (ya se sacó)");
  if (!hayColumna) {
    console.log("Nada que hacer.");
    return;
  }

  if (!APLICAR) {
    console.log("\nChequeo OK. Para aplicar: --aplicar");
    return;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ArtefactoCatalog" DROP COLUMN IF EXISTS "clientPrice"`
  );
  console.log("\nALTER aplicado.");

  const despues = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM information_schema.columns
     WHERE table_name = 'ArtefactoCatalog' AND column_name = 'clientPrice'`
  );
  console.log("Columna presente ahora:", Number(despues[0].count) > 0 ? "SÍ (falló)" : "no");

  // El catálogo tiene que seguir leyéndose igual.
  const n = await prisma.artefactoCatalog.count();
  const muestra = await prisma.artefactoCatalog.findFirst({
    select: { name: true, listPrice: true, discountPercent: true },
    orderBy: { name: "asc" },
  });
  console.log(`\nCatálogo sigue OK: ${n} productos. Muestra:`, JSON.stringify(muestra));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
