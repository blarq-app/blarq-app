/**
 * Backfill de ObraItemComponent.originComponentId para data anterior al
 * 2026-05-15 (introducción del sync diferencial).
 *
 * Para cada ObraItemComponent sin originComponentId, en un ObraItem que
 * vino de catálogo (catalogPartidaId != null), intenta matchear con un
 * PartidaComponent de esa misma partida del catálogo siguiendo esta
 * estrategia, en orden:
 *
 *   1) Mismo materialId + mismo type + mismo partidaId → match exacto.
 *   2) Sin materialId: mismo type + description (case-insensitive) +
 *      unit + appliedToType.
 *
 * Si hay UNA sola coincidencia, se mapea. Si hay 0 o más de 1, se deja
 * null y se reporta. Idempotente: ya mapeados se saltan.
 *
 * Uso: npx tsx scripts/backfill-origin-component-id.ts [--dry-run]
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface Stats {
  obraItemsScanned: number;
  componentsScanned: number;
  matchedByMaterial: number;
  matchedByDescription: number;
  unmatched: number;
  ambiguous: number;
  alreadyMapped: number;
  skippedNoCatalog: number;
}

async function main() {
  const stats: Stats = {
    obraItemsScanned: 0,
    componentsScanned: 0,
    matchedByMaterial: 0,
    matchedByDescription: 0,
    unmatched: 0,
    ambiguous: 0,
    alreadyMapped: 0,
    skippedNoCatalog: 0,
  };

  const obraItems = await prisma.obraItem.findMany({
    where: { catalogPartidaId: { not: null } },
    select: {
      id: true,
      catalogPartidaId: true,
      name: true,
      components: {
        select: {
          id: true,
          type: true,
          description: true,
          unit: true,
          materialId: true,
          originComponentId: true,
          appliedToType: true,
        },
      },
    },
  });

  console.log(
    `Encontrados ${obraItems.length} ObraItem con catalogPartidaId.${dryRun ? " (DRY RUN)" : ""}`
  );

  for (const oi of obraItems) {
    stats.obraItemsScanned++;
    const catalogComps = await prisma.partidaComponent.findMany({
      where: { partidaId: oi.catalogPartidaId! },
      select: {
        id: true,
        type: true,
        description: true,
        unit: true,
        materialId: true,
        appliedToType: true,
      },
    });

    // IDs del catálogo que ya están reclamados por algún OIComp mapeado de
    // este mismo ObraItem — no los reutilizamos para evitar mapear dos
    // OIComps al mismo PartidaComponent.
    const claimed = new Set<string>(
      oi.components
        .filter((c) => c.originComponentId !== null)
        .map((c) => c.originComponentId!)
    );

    for (const c of oi.components) {
      stats.componentsScanned++;
      if (c.originComponentId) {
        stats.alreadyMapped++;
        continue;
      }
      if (catalogComps.length === 0) {
        stats.skippedNoCatalog++;
        continue;
      }

      let match: { id: string; how: "material" | "description" } | null = null;

      // 1) Match por materialId si está presente
      if (c.materialId) {
        const cands = catalogComps.filter(
          (cc) =>
            !claimed.has(cc.id) &&
            cc.type === c.type &&
            cc.materialId === c.materialId
        );
        if (cands.length === 1) {
          match = { id: cands[0].id, how: "material" };
        } else if (cands.length > 1) {
          // varios PartidaComponent con mismo materialId — desambiguar con
          // unit + appliedToType
          const narrowed = cands.filter(
            (cc) =>
              cc.unit === c.unit &&
              (cc.appliedToType ?? null) === (c.appliedToType ?? null)
          );
          if (narrowed.length === 1) match = { id: narrowed[0].id, how: "material" };
          else if (narrowed.length === 0) match = null;
          else {
            stats.ambiguous++;
            continue;
          }
        }
      }

      // 2) Match por description + type + unit + appliedToType (case-insensitive)
      if (!match) {
        const wanted = c.description.trim().toLowerCase();
        const cands = catalogComps.filter(
          (cc) =>
            !claimed.has(cc.id) &&
            cc.type === c.type &&
            cc.unit === c.unit &&
            (cc.appliedToType ?? null) === (c.appliedToType ?? null) &&
            cc.description.trim().toLowerCase() === wanted
        );
        if (cands.length === 1) {
          match = { id: cands[0].id, how: "description" };
        } else if (cands.length > 1) {
          stats.ambiguous++;
          continue;
        }
      }

      if (!match) {
        stats.unmatched++;
        continue;
      }

      claimed.add(match.id);
      if (match.how === "material") stats.matchedByMaterial++;
      else stats.matchedByDescription++;

      if (!dryRun) {
        await prisma.obraItemComponent.update({
          where: { id: c.id },
          data: { originComponentId: match.id },
        });
      }
    }
  }

  console.log("\nResumen:");
  console.log(`  ObraItems escaneados:    ${stats.obraItemsScanned}`);
  console.log(`  Componentes escaneados:  ${stats.componentsScanned}`);
  console.log(`  Ya mapeados (skip):      ${stats.alreadyMapped}`);
  console.log(`  Match por materialId:    ${stats.matchedByMaterial}`);
  console.log(`  Match por descripción:   ${stats.matchedByDescription}`);
  console.log(`  Ambiguos (>1 match):     ${stats.ambiguous}`);
  console.log(`  Sin match (quedan null): ${stats.unmatched}`);
  console.log(`  Sin componentes en cat.: ${stats.skippedNoCatalog}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
