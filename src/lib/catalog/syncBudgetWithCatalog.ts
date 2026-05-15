/**
 * Diff diferencial entre un BudgetVersion en borrador y el PartidaCatalog
 * actual. Sincroniza tres cosas por cada ObraItem que vino de catálogo y
 * no fue customizado a nivel partida:
 *
 *   1) AGREGA  los componentes que están en el catálogo y no en el ObraItem
 *              (y que MJ no descartó intencionalmente en este proyecto).
 *   2) ACTUALIZA los componentes existentes cuyos datos no coinciden con
 *              el catálogo (description / unit / unitCost / referenceLink /
 *              quantity / appliedToType). Solo si el componente del proyecto
 *              no está marcado como isCustomized.
 *   3) BORRA   los componentes del proyecto cuyo origen ya no existe en
 *              el catálogo (originComponentId apunta a un PartidaComponent
 *              borrado). Solo si el componente no está customizado.
 *
 * Después recalcula totales del ObraItem.
 *
 * Reglas:
 *   - Solo opera sobre BudgetVersion.status = "borrador".
 *   - Solo sobre ObraItem que tengan catalogPartidaId no-null Y no estén
 *     marcados como ObraItem.isCustomized.
 *   - REGLA CONTRACTUAL (MJ 2026-05-15): si la partida tiene el mismo
 *     lineageId que una partida de una versión anterior con status
 *     enviado/aprobado, queda blindada — esa partida ya se le mostró al
 *     cliente con esos valores y solo MJ puede modificarla a mano. Esto
 *     vale aunque la versión actual sea borrador. Las partidas con
 *     lineageId nuevo (creadas en esta versión, no heredadas) sí se
 *     sincronizan.
 *   - Componentes sin originComponentId (data vieja anterior al sync
 *     diferencial) NO se borran — no hay forma de saber si son huérfanos
 *     del catálogo o componentes locales del proyecto. Se respetan.
 *   - Componentes descartados intencionalmente (ObraItemDiscardedCatalogComponent)
 *     no se recrean automáticamente.
 */

import { prisma } from "@/lib/prisma";
import { recalcObraItemFromComponents } from "./recalcObraItem";
import { getFrozenLineageIds } from "./frozenLineage";

export interface BudgetCatalogSyncSummary {
  budgetVersionId: string;
  obraItemsScanned: number;
  obraItemsSkippedCustomized: number;
  obraItemsSkippedFrozenLineage: number; // heredadas de versión enviada/aprobada
  componentsAdded: number;
  componentsUpdated: number;
  componentsRemoved: number;
  obraItemsRecalculated: number;
}

export async function syncBudgetWithCatalog(
  budgetVersionId: string
): Promise<BudgetCatalogSyncSummary> {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: budgetVersionId },
    select: { id: true, status: true, projectId: true, type: true },
  });
  if (!bv) {
    throw new Error(`BudgetVersion ${budgetVersionId} no existe`);
  }
  if (bv.status !== "borrador") {
    throw new Error(
      `Solo se puede sincronizar BudgetVersion en borrador (actual: ${bv.status})`
    );
  }

  const frozenLineageSet = await getFrozenLineageIds(bv.projectId, bv.type);

  const obraItems = await prisma.obraItem.findMany({
    where: {
      budgetVersionId,
      catalogPartidaId: { not: null },
    },
    select: {
      id: true,
      catalogPartidaId: true,
      isCustomized: true,
      lineageId: true,
    },
  });

  let componentsAdded = 0;
  let componentsUpdated = 0;
  let componentsRemoved = 0;
  let obraItemsSkipped = 0;
  let obraItemsSkippedFrozen = 0;
  const recalcTargets = new Set<string>();

  for (const item of obraItems) {
    if (item.isCustomized) {
      obraItemsSkipped++;
      continue;
    }
    if (frozenLineageSet.has(item.lineageId)) {
      // Partida heredada de una versión ya enviada/aprobada: blindada por
      // contrato. MJ solo puede cambiarla a mano.
      obraItemsSkippedFrozen++;
      continue;
    }
    const partidaId = item.catalogPartidaId!;

    const [catalogComps, projectComps, discarded] = await Promise.all([
      prisma.partidaComponent.findMany({
        where: { partidaId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.obraItemComponent.findMany({
        where: { obraItemId: item.id },
      }),
      prisma.obraItemDiscardedCatalogComponent.findMany({
        where: { obraItemId: item.id },
        select: { partidaComponentId: true },
      }),
    ]);

    const discardedIds = new Set(discarded.map((d) => d.partidaComponentId));
    const projectByOrigin = new Map(
      projectComps
        .filter((c) => c.originComponentId !== null)
        .map((c) => [c.originComponentId!, c])
    );
    const catalogIds = new Set(catalogComps.map((c) => c.id));

    // Guarda defensiva contra data vieja: si el ObraItem tiene componentes
    // pero NINGUNO está mapeado al catálogo (originComponentId), asumimos
    // que es snapshot anterior al backfill — no agregamos ni borramos,
    // porque no sabemos qué componente del catálogo corresponde a cuál
    // del proyecto. Sin esta guarda, agregaríamos todos los del catálogo
    // y dejaríamos duplicados. Cuando MJ corra el script de backfill, los
    // mapeos se llenan y este ObraItem pasa a sincronizarse normal.
    const legacyUnmapped =
      projectComps.length > 0 &&
      projectComps.every((c) => c.originComponentId === null);

    let touched = false;

    // ── AGREGAR ────────────────────────────────────────────────
    // Componentes del catálogo que no están mapeados en el ObraItem
    // y que MJ no descartó intencionalmente.
    //
    // Protección anti-duplicados: si en el ObraItem hay un componente
    // SIN originComponentId (data vieja que el backfill no pudo mapear)
    // y coincide con uno del catálogo por type+description+unit+materialId,
    // no lo agregamos de nuevo — asumimos que es el mismo. Esto cubre el
    // caso de backfill ambiguo o sin match.
    const orphanProjectComps = projectComps.filter(
      (p) => p.originComponentId === null
    );
    const looseMatch = (
      cat: typeof catalogComps[number]
    ): (typeof projectComps)[number] | undefined =>
      orphanProjectComps.find(
        (p) =>
          p.type === cat.type &&
          p.unit === cat.unit &&
          (p.materialId ?? null) === (cat.materialId ?? null) &&
          p.description.trim().toLowerCase() ===
            cat.description.trim().toLowerCase()
      );

    const newOriginIdToNewId = new Map<string, string>();
    if (legacyUnmapped) {
      // skip: no agregamos para no duplicar
    } else {
    for (const c of catalogComps) {
      if (projectByOrigin.has(c.id)) continue;
      if (discardedIds.has(c.id)) continue;
      // Si ya existe un huérfano equivalente, no agregamos
      if (looseMatch(c)) continue;

      // Cargar datos del material si hace falta refrescar description/unitCost
      let description = c.description;
      let unit = c.unit;
      let unitCost = c.unitCost;
      let referenceLink = c.referenceLink;
      if (c.materialId) {
        const mat = await prisma.materialCatalog.findUnique({
          where: { id: c.materialId },
        });
        if (mat) {
          description = mat.name;
          unit = mat.unit;
          unitCost = mat.netPrice;
          referenceLink = mat.referenceLink;
        }
      }

      const created = await prisma.obraItemComponent.create({
        data: {
          obraItemId: item.id,
          type: c.type,
          description,
          unit,
          quantity: c.quantity,
          unitCost,
          totalCost: c.totalCost,
          referenceLink,
          materialId: c.materialId,
          sortOrder: c.sortOrder,
          appliedToType: c.appliedToType,
          // appliedToComponentId se resuelve en segunda pasada (puede
          // apuntar a un componente que también acabamos de crear o a
          // uno preexistente del proyecto).
          originComponentId: c.id,
        },
      });
      newOriginIdToNewId.set(c.id, created.id);
      componentsAdded++;
      touched = true;
    }

    // Segunda pasada: resolver appliedToComponentId en componentes nuevos.
    // El target puede ser otro componente recién creado o uno que ya
    // estaba en el proyecto (mapeado por originComponentId).
    for (const c of catalogComps) {
      const newId = newOriginIdToNewId.get(c.id);
      if (!newId) continue;
      if (!c.appliedToComponentId) continue;
      const targetNew = newOriginIdToNewId.get(c.appliedToComponentId);
      const targetExisting = projectByOrigin.get(c.appliedToComponentId);
      const resolved = targetNew ?? targetExisting?.id ?? null;
      if (resolved) {
        await prisma.obraItemComponent.update({
          where: { id: newId },
          data: { appliedToComponentId: resolved },
        });
      }
    }
    } // fin del else (legacyUnmapped)

    // ── ACTUALIZAR ─────────────────────────────────────────────
    // Componentes ya mapeados al catálogo: refrescar description/unit/unitCost/
    // quantity/appliedToType desde el catálogo si el componente no es custom.
    // Si el componente tiene materialId, los datos visibles vienen del material.
    for (const c of catalogComps) {
      const existing = projectByOrigin.get(c.id);
      if (!existing) continue;
      if (existing.isCustomized) continue;

      let description = c.description;
      let unit = c.unit;
      let unitCost = c.unitCost;
      let referenceLink = c.referenceLink;
      if (c.materialId) {
        const mat = await prisma.materialCatalog.findUnique({
          where: { id: c.materialId },
        });
        if (mat) {
          description = mat.name;
          unit = mat.unit;
          unitCost = mat.netPrice;
          referenceLink = mat.referenceLink;
        }
      }

      const needsUpdate =
        existing.description !== description ||
        existing.unit !== unit ||
        Math.abs(existing.unitCost - unitCost) > 0.01 ||
        Math.abs(existing.quantity - c.quantity) > 0.0001 ||
        (existing.referenceLink ?? null) !== (referenceLink ?? null) ||
        (existing.appliedToType ?? null) !== (c.appliedToType ?? null) ||
        (existing.materialId ?? null) !== (c.materialId ?? null);

      if (!needsUpdate) continue;

      await prisma.obraItemComponent.update({
        where: { id: existing.id },
        data: {
          description,
          unit,
          quantity: c.quantity,
          unitCost,
          referenceLink,
          materialId: c.materialId,
          appliedToType: c.appliedToType,
        },
      });
      componentsUpdated++;
      touched = true;
    }

    // ── BORRAR ─────────────────────────────────────────────────
    // Componentes del proyecto cuyo origen ya no existe en el catálogo.
    // Solo si: originComponentId está seteado, no aparece en el catálogo
    // actual, y el componente no es customizado.
    for (const c of projectComps) {
      if (!c.originComponentId) continue; // data vieja sin mapeo: no tocar
      if (catalogIds.has(c.originComponentId)) continue;
      if (c.isCustomized) continue;
      await prisma.obraItemComponent.delete({ where: { id: c.id } });
      componentsRemoved++;
      touched = true;
    }

    if (touched) recalcTargets.add(item.id);
  }

  for (const itemId of recalcTargets) {
    await recalcObraItemFromComponents(itemId);
  }

  return {
    budgetVersionId,
    obraItemsScanned: obraItems.length,
    obraItemsSkippedCustomized: obraItemsSkipped,
    obraItemsSkippedFrozenLineage: obraItemsSkippedFrozen,
    componentsAdded,
    componentsUpdated,
    componentsRemoved,
    obraItemsRecalculated: recalcTargets.size,
  };
}
