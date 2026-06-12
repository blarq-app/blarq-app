/**
 * Re-etiquetado del tipo "Duchas" → "Ducha/Receptáculo".
 *
 * Contexto (2026-06-12, pedido MJ): el tipo "Duchas" del catálogo de
 * artefactos se parte en dos — "Ducha/Receptáculo" y "Tina". Revisado el
 * catálogo real (dev 9, prod 21): ninguno de los artefactos etiquetados
 * "Duchas" es una tina (son columnas, griferías de ducha, platos,
 * receptáculos, desagües, barras), así que TODOS pasan al nuevo nombre y
 * "Tina" arranca vacía para futuras cargas.
 *
 * Uso:
 *   npx tsx scripts/retag-duchas.ts            → dry-run (muestra, no toca)
 *   npx tsx scripts/retag-duchas.ts --apply    → aplica
 *
 * La base la decide DATABASE_URL (dev por default vía .env; para prod,
 * exportar la URL de prod antes de correr — con OK de MJ).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const items = await prisma.artefactoCatalog.findMany({
    where: { tag: "Duchas" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`Artefactos con tipo "Duchas": ${items.length}`);
  for (const i of items) console.log(`  - ${i.name} → Ducha/Receptáculo`);

  if (!APPLY) {
    console.log("\nDry-run: no se tocó nada. Correr con --apply para aplicar.");
    return;
  }
  const res = await prisma.artefactoCatalog.updateMany({
    where: { tag: "Duchas" },
    data: { tag: "Ducha/Receptáculo" },
  });
  console.log(`\nAplicado: ${res.count} artefactos re-etiquetados.`);
  const quedan = await prisma.artefactoCatalog.count({
    where: { tag: "Duchas" },
  });
  console.log(`Quedan con "Duchas": ${quedan} (esperado 0).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
