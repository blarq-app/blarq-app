/**
 * Sincronización MaterialCatalog → componentes que lo referencian.
 *
 * Cuando MJ edita un material en /catalogo/materiales, queremos que:
 *   1) PartidaComponent que lo usa quede al día (description / unitCost /
 *      referenceLink). Siempre se aplica — el catálogo de partidas vive
 *      sincronizado con materiales.
 *   2) ObraItemComponent (snapshot por proyecto) en presupuestos que
 *      todavía son "borrador" se actualice, RESPETANDO componentes
 *      marcados como isCustomized=true (MJ los editó manualmente y no
 *      queremos pisarle el trabajo).
 *
 * Los presupuestos en status "enviado" / "aprobado" / "rechazado" NUNCA
 * se tocan — esos están congelados como histórico.
 */

import { prisma } from "@/lib/prisma";
import { recalcPartidaTotals } from "./recalcPartida";
import { recalcObraItemFromComponents } from "./recalcObraItem";
import { getFrozenLineageIds } from "./frozenLineage";

interface SyncSummary {
  materialId: string;
  partidaComponentsUpdated: number;
  partidasRecalculated: number;
  obraItemComponentsUpdated: number;
  obraItemComponentsSkipped: number; // por estar customized
  obraItemsRecalculated: number;
  budgetVersionsAffected: number;
}

/**
 * Propaga los cambios de un material a todos los componentes que lo
 * referencian. Por defecto solo toca PartidaCatalog. Pasar
 * `propagateToBudgets: true` para también actualizar presupuestos en
 * borrador (respeta isCustomized).
 */
export async function syncMaterialToComponents(
  materialId: string,
  opts: { propagateToBudgets?: boolean } = {}
): Promise<SyncSummary> {
  const material = await prisma.materialCatalog.findUnique({
    where: { id: materialId },
  });
  if (!material) {
    throw new Error(`Material ${materialId} no existe`);
  }

  // ── PartidaComponent ──────────────────────────────────────────
  const partidaComps = await prisma.partidaComponent.findMany({
    where: { materialId },
    select: { id: true, partidaId: true },
  });
  const partidaIds = Array.from(new Set(partidaComps.map((c) => c.partidaId)));

  for (const c of partidaComps) {
    await prisma.partidaComponent.update({
      where: { id: c.id },
      data: {
        description: material.name,
        unit: material.unit,
        unitCost: material.netPrice,
        referenceLink: material.referenceLink,
      },
    });
  }

  // Recalcular totales de cada partida afectada
  for (const pid of partidaIds) {
    await recalcPartidaTotals(pid);
  }

  // ── ObraItemComponent (solo en presupuestos en borrador) ──────
  let obraItemCompsUpdated = 0;
  let obraItemCompsSkipped = 0;
  const obraItemIdsAffected = new Set<string>();
  const budgetVersionIdsAffected = new Set<string>();

  if (opts.propagateToBudgets) {
    const candidates = await prisma.obraItemComponent.findMany({
      where: {
        materialId,
        obraItem: {
          budgetVersion: { status: "borrador" },
        },
      },
      select: {
        id: true,
        obraItemId: true,
        isCustomized: true,
        obraItem: {
          select: {
            budgetVersionId: true,
            lineageId: true,
            isCustomized: true,
            budgetVersion: { select: { projectId: true, type: true } },
          },
        },
      },
    });

    for (const c of candidates) {
      if (c.isCustomized) {
        obraItemCompsSkipped++;
        continue;
      }
      // Regla contractual: si la partida del proyecto está marcada como
      // customizada O su lineageId aparece en una versión enviada/aprobada,
      // no la pisamos aunque cambie el material en el catálogo.
      if (c.obraItem.isCustomized) {
        obraItemCompsSkipped++;
        continue;
      }
      const frozen = await getFrozenLineageIds(
        c.obraItem.budgetVersion.projectId,
        c.obraItem.budgetVersion.type
      );
      if (frozen.has(c.obraItem.lineageId)) {
        obraItemCompsSkipped++;
        continue;
      }
      await prisma.obraItemComponent.update({
        where: { id: c.id },
        data: {
          description: material.name,
          unit: material.unit,
          unitCost: material.netPrice,
          referenceLink: material.referenceLink,
        },
      });
      obraItemCompsUpdated++;
      obraItemIdsAffected.add(c.obraItemId);
      budgetVersionIdsAffected.add(c.obraItem.budgetVersionId);
    }

    // Recalcular ObraItem.unitPrice / total / cost* desde sus componentes
    for (const itemId of obraItemIdsAffected) {
      await recalcObraItemFromComponents(itemId);
    }
  }

  return {
    materialId,
    partidaComponentsUpdated: partidaComps.length,
    partidasRecalculated: partidaIds.length,
    obraItemComponentsUpdated: obraItemCompsUpdated,
    obraItemComponentsSkipped: obraItemCompsSkipped,
    obraItemsRecalculated: obraItemIdsAffected.size,
    budgetVersionsAffected: budgetVersionIdsAffected.size,
  };
}
