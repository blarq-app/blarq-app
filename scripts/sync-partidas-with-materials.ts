/**
 * Fase 0 — Limpieza inicial.
 *
 * Para cada PartidaComponent con materialId linkeado, sincroniza
 * description / unit / unitCost / referenceLink desde su MaterialCatalog.
 * Después recalcula los totales de cada partida afectada.
 *
 * Para ObraItemComponent (snapshot por proyecto): NO toca nada por
 * default. Pasar `--include-borradores` para también sincronizar
 * componentes en presupuestos status="borrador", respetando isCustomized.
 *
 * Uso:
 *   npx tsx scripts/sync-partidas-with-materials.ts            # dry-run
 *   npx tsx scripts/sync-partidas-with-materials.ts --apply
 *   npx tsx scripts/sync-partidas-with-materials.ts --apply --include-borradores
 */

// dotenv DEBE cargar antes que cualquier import que toque prisma — si no,
// PrismaClient se inicializa sin DATABASE_URL y falla. Apuntamos al .env del
// repo principal porque el worktree no tiene .env propio.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../../../.env") });

import { syncMaterialToComponents } from "../src/lib/catalog/syncMaterial";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const INCLUDE_BORRADORES = process.argv.includes("--include-borradores");

interface Diff {
  materialId: string;
  materialName: string;
  catalogPrice: number;
  diffs: Array<{
    componentId: string;
    partidaName: string;
    oldDescription: string;
    oldUnitCost: number;
    newDescription: string;
    newUnitCost: number;
  }>;
}

async function main() {
  console.log(
    `${APPLY ? "[APPLY]" : "[DRY-RUN]"} Sync PartidaComponent ← MaterialCatalog${INCLUDE_BORRADORES ? " (incluye borradores)" : ""}`
  );

  // Listar TODOS los materiales con componentes linkeados
  const materials = await prisma.materialCatalog.findMany({
    where: { components: { some: {} } },
    include: {
      components: {
        include: { partida: { select: { name: true } } },
      },
    },
  });

  const allDiffs: Diff[] = [];

  for (const mat of materials) {
    const diffs = mat.components
      .filter(
        (c) =>
          c.description !== mat.name ||
          Math.abs(c.unitCost - mat.netPrice) > 0.01 ||
          (c.referenceLink ?? null) !== (mat.referenceLink ?? null)
      )
      .map((c) => ({
        componentId: c.id,
        partidaName: c.partida.name,
        oldDescription: c.description,
        oldUnitCost: c.unitCost,
        newDescription: mat.name,
        newUnitCost: mat.netPrice,
      }));

    if (diffs.length === 0) continue;
    allDiffs.push({
      materialId: mat.id,
      materialName: mat.name,
      catalogPrice: mat.netPrice,
      diffs,
    });
  }

  if (allDiffs.length === 0) {
    console.log("\nNo hay PartidaComponent desactualizados. Todo en orden.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nMateriales con componentes desactualizados: ${allDiffs.length}\n`);

  let totalCompsToSync = 0;
  for (const d of allDiffs) {
    console.log(`Material: ${d.materialName}  →  $${Math.round(d.catalogPrice)}`);
    for (const x of d.diffs) {
      console.log(
        `  · [${x.partidaName}] "${x.oldDescription}" $${Math.round(x.oldUnitCost)} → "${x.newDescription}" $${Math.round(x.newUnitCost)}`
      );
      totalCompsToSync++;
    }
  }

  console.log(`\nTotal componentes a sincronizar: ${totalCompsToSync}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — re-correr con --apply para escribir.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nAplicando…");
  let totalSummary = {
    partidaComponentsUpdated: 0,
    partidasRecalculated: 0,
    obraItemComponentsUpdated: 0,
    obraItemComponentsSkipped: 0,
    obraItemsRecalculated: 0,
    budgetVersionsAffected: 0,
  };
  for (const d of allDiffs) {
    const summary = await syncMaterialToComponents(d.materialId, {
      propagateToBudgets: INCLUDE_BORRADORES,
    });
    totalSummary.partidaComponentsUpdated += summary.partidaComponentsUpdated;
    totalSummary.partidasRecalculated += summary.partidasRecalculated;
    totalSummary.obraItemComponentsUpdated += summary.obraItemComponentsUpdated;
    totalSummary.obraItemComponentsSkipped += summary.obraItemComponentsSkipped;
    totalSummary.obraItemsRecalculated += summary.obraItemsRecalculated;
    totalSummary.budgetVersionsAffected += summary.budgetVersionsAffected;
  }

  console.log("\nResumen:");
  console.log(`  PartidaComponent actualizados: ${totalSummary.partidaComponentsUpdated}`);
  console.log(`  Partidas recalculadas:         ${totalSummary.partidasRecalculated}`);
  if (INCLUDE_BORRADORES) {
    console.log(`  ObraItemComp actualizados:     ${totalSummary.obraItemComponentsUpdated}`);
    console.log(`  ObraItemComp omitidos (custom):${totalSummary.obraItemComponentsSkipped}`);
    console.log(`  ObraItems recalculados:        ${totalSummary.obraItemsRecalculated}`);
    console.log(`  Presupuestos borrador afectados: ${totalSummary.budgetVersionsAffected}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
