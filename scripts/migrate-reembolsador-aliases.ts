/**
 * Migración: para cada Reembolsador que tenga `rutAlias` poblado pero
 * ninguna fila en ReembolsadorAlias, crea una fila a partir de los
 * campos legacy `rutAlias` + `businessName`.
 *
 * Idempotente — solo crea filas que faltan. Si un Reembolsador ya tiene
 * aliases en la tabla nueva, se ignora (asumimos que ya fue migrado o
 * que MJ ya configuró aliases más recientes).
 *
 * Uso:
 *   # Contra el BD apuntado por DATABASE_URL del .env (dev por default):
 *   npx tsx scripts/migrate-reembolsador-aliases.ts            # dry-run
 *   npx tsx scripts/migrate-reembolsador-aliases.ts --apply    # escribe
 *
 *   # Contra prod (override de DATABASE_URL en la shell):
 *   DATABASE_URL="<prod-url>" npx tsx scripts/migrate-reembolsador-aliases.ts --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const reembolsadores = await prisma.reembolsador.findMany({
    include: { aliases: true },
    orderBy: { nombre: "asc" },
  });

  console.log(`Total reembolsadores: ${reembolsadores.length}`);
  console.log(`Modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN"}\n`);

  let toMigrate = 0;
  let skippedHasAliases = 0;
  let skippedNoLegacy = 0;
  const plan: { id: string; nombre: string; rut: string; businessName: string | null }[] = [];

  for (const r of reembolsadores) {
    if (r.aliases.length > 0) {
      skippedHasAliases++;
      continue;
    }
    if (!r.rutAlias) {
      skippedNoLegacy++;
      continue;
    }
    plan.push({
      id: r.id,
      nombre: r.nombre,
      rut: r.rutAlias,
      businessName: r.businessName,
    });
    toMigrate++;
  }

  console.log(`Para migrar: ${toMigrate}`);
  console.log(`Ya tiene aliases (skip): ${skippedHasAliases}`);
  console.log(`Sin rutAlias legacy (skip): ${skippedNoLegacy}\n`);

  if (plan.length === 0) {
    console.log("Nada que hacer.");
    return;
  }

  for (const p of plan) {
    console.log(
      `  ${p.nombre.padEnd(20)} → ${p.rut.padEnd(13)} ${p.businessName ?? "(sin businessName)"}`
    );
  }

  if (!APPLY) {
    console.log("\nDry-run. Corré con --apply para escribir.");
    return;
  }

  console.log("\nAplicando...");
  for (const p of plan) {
    await prisma.reembolsadorAlias.create({
      data: {
        reembolsadorId: p.id,
        rut: p.rut,
        businessName: p.businessName,
      },
    });
    console.log(`  ✓ ${p.nombre}`);
  }
  console.log(`\nListo. ${plan.length} aliases creados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
