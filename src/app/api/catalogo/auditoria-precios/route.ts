/**
 * Auditoría de precios desactualizados.
 *
 * GET: detecta tres tipos de desactualización en presupuestos status="borrador":
 *      (a) componentes existentes cuyo unitCost/description difiere del
 *          MaterialCatalog linkeado (update).
 *      (b) componentes del catálogo de partidas que faltan en el ObraItem
 *          (add) — pasaron a existir después de copiar la partida.
 *      (c) componentes del proyecto cuyo origen ya no está en el catálogo
 *          (remove) — se borraron del catálogo después.
 *      Solo cuenta componentes/partidas que NO están customizados y cuyo
 *      lineage no esté congelado por una versión enviada/aprobada.
 *
 *      Devuelve:
 *        - totalStaleComponents / groups / etc. → resumen histórico que usa la
 *          página /configuracion/auditoria-precios (NO cambiar la forma).
 *        - changes[] → lista granular (un objeto por diferencia) que usa el
 *          panel "Actualizar" del editor para que MJ acepte/rechace cambio por
 *          cambio. Pensado para llamarse con ?budgetId= (un solo borrador).
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getFrozenLineageIds } from "@/lib/catalog/frozenLineage";
import type { AuditChange } from "@/lib/catalog/auditChanges";

export async function GET(request: NextRequest) {
  try {
    // Si se pasa ?budgetId=xxx limitamos al presupuesto puntual (lo usa el
    // panel del editor de presupuesto). Sin parámetro, lista todos los
    // borradores (para la página /configuracion/auditoria-precios).
    const budgetId = request.nextUrl.searchParams.get("budgetId");

    // Cache de lineages congelados por (projectId|type) — se reusa entre
    // componentes y partidas para no consultar de más.
    const frozenCache = new Map<string, Set<string>>();
    const frozenSet = async (projectId: string, type: string) => {
      const key = `${projectId}|${type}`;
      if (!frozenCache.has(key)) {
        frozenCache.set(key, await getFrozenLineageIds(projectId, type));
      }
      return frozenCache.get(key)!;
    };

    const changes: AuditChange[] = [];

    // ── (a) Componentes con material linkeado, desactualizados ────────
    const components = await prisma.obraItemComponent.findMany({
      where: {
        materialId: { not: null },
        isCustomized: false,
        obraItem: {
          budgetVersionId: budgetId ?? undefined,
          budgetVersion: { status: "borrador" },
        },
      },
      include: {
        material: true,
        obraItem: {
          select: {
            id: true,
            name: true,
            itemNumber: true,
            isCustomized: true,
            lineageId: true,
            budgetVersion: {
              select: {
                id: true,
                version: true,
                date: true,
                projectId: true,
                type: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Detectar diff vs el material
    const stale = components.filter((c) => {
      if (!c.material) return false;
      return (
        c.description !== c.material.name ||
        Math.abs(c.unitCost - c.material.netPrice) > 0.01 ||
        (c.referenceLink ?? null) !== (c.material.referenceLink ?? null)
      );
    });

    // changes "update" — respetando partida customizada / lineage congelado
    // (esos el aplicar los saltaría, así que no los ofrecemos).
    for (const c of stale) {
      const oi = c.obraItem;
      if (oi.isCustomized) continue;
      const frozen = await frozenSet(
        oi.budgetVersion.projectId,
        oi.budgetVersion.type
      );
      if (frozen.has(oi.lineageId)) continue;
      changes.push({
        kind: "update",
        id: c.id,
        obraItemId: oi.id,
        budgetVersionId: oi.budgetVersion.id,
        itemNumber: oi.itemNumber,
        itemName: oi.name,
        compType: c.type,
        oldDescription: c.description,
        newDescription: c.material!.name,
        oldUnitCost: c.unitCost,
        newUnitCost: c.material!.netPrice,
      });
    }

    // ── (b) y (c): diff con el catálogo de partidas ───────────────────
    const obraItemsBudget = await prisma.obraItem.findMany({
      where: {
        budgetVersionId: budgetId ?? undefined,
        budgetVersion: { status: "borrador" },
        catalogPartidaId: { not: null },
        isCustomized: false,
      },
      select: {
        id: true,
        name: true,
        itemNumber: true,
        catalogPartidaId: true,
        budgetVersionId: true,
        lineageId: true,
        budgetVersion: {
          select: { id: true, projectId: true, type: true },
        },
        components: {
          select: {
            id: true,
            originComponentId: true,
            type: true,
            description: true,
            unit: true,
            unitCost: true,
            quantity: true,
            materialId: true,
          },
        },
        discardedCatalogComponents: { select: { partidaComponentId: true } },
      },
    });

    let missingCount = 0;
    let orphanCount = 0;
    const budgetIdsWithDiff = new Set<string>();
    for (const oi of obraItemsBudget) {
      const catalogComps = await prisma.partidaComponent.findMany({
        where: { partidaId: oi.catalogPartidaId! },
        select: {
          id: true,
          type: true,
          description: true,
          unit: true,
          unitCost: true,
          quantity: true,
          materialId: true,
        },
      });
      const catalogIds = new Set(catalogComps.map((c) => c.id));
      const projectOriginIds = new Set(
        oi.components
          .filter((c) => c.originComponentId !== null)
          .map((c) => c.originComponentId!)
      );
      const discardedIds = new Set(
        oi.discardedCatalogComponents.map((d) => d.partidaComponentId)
      );

      // Guarda contra data vieja: si tiene componentes pero ninguno está
      // mapeado (originComponentId=null en todos), no contamos diferencias.
      const legacyUnmapped =
        oi.components.length > 0 &&
        oi.components.every((c) => c.originComponentId === null);
      if (legacyUnmapped) continue;

      // Guarda por contrato: partida heredada de una versión enviada/aprobada.
      const frozen = await frozenSet(
        oi.budgetVersion.projectId,
        oi.budgetVersion.type
      );
      if (frozen.has(oi.lineageId)) continue;

      // Componentes huérfanos del proyecto (sin originComponentId) — para
      // descartar faltantes que ya están presentes por loose match.
      const orphanProjectComps = oi.components.filter(
        (c) => c.originComponentId === null
      );
      const hasLooseMatch = (cat: (typeof catalogComps)[number]) =>
        orphanProjectComps.some(
          (p) =>
            p.type === cat.type &&
            p.unit === cat.unit &&
            (p.materialId ?? null) === (cat.materialId ?? null) &&
            p.description.trim().toLowerCase() ===
              cat.description.trim().toLowerCase()
        );

      // Faltantes (add): en catálogo, no mapeados, no descartados, sin loose match.
      for (const cat of catalogComps) {
        if (projectOriginIds.has(cat.id)) continue;
        if (discardedIds.has(cat.id)) continue;
        if (hasLooseMatch(cat)) continue;
        missingCount++;
        changes.push({
          kind: "add",
          id: cat.id,
          obraItemId: oi.id,
          budgetVersionId: oi.budgetVersion.id,
          itemNumber: oi.itemNumber,
          itemName: oi.name,
          compType: cat.type,
          description: cat.description,
          unit: cat.unit,
          unitCost: cat.unitCost,
          quantity: cat.quantity,
        });
        budgetIdsWithDiff.add(oi.budgetVersionId);
      }

      // Huérfanos (remove): en proyecto con originComponentId que ya no existe
      // en el catálogo.
      for (const c of oi.components) {
        if (!c.originComponentId) continue;
        if (catalogIds.has(c.originComponentId)) continue;
        orphanCount++;
        changes.push({
          kind: "remove",
          id: c.id,
          obraItemId: oi.id,
          budgetVersionId: oi.budgetVersion.id,
          itemNumber: oi.itemNumber,
          itemName: oi.name,
          compType: c.type,
          description: c.description,
          unit: c.unit,
          unitCost: c.unitCost,
          quantity: c.quantity,
        });
        budgetIdsWithDiff.add(oi.budgetVersionId);
      }
    }

    // ── Resumen histórico para la página de configuración (NO cambiar) ──
    type BudgetGroup = {
      budgetId: string;
      version: string;
      projectId: string;
      projectName: string;
      date: Date;
      components: Array<{
        componentId: string;
        itemName: string;
        itemNumber: string;
        oldDescription: string;
        newDescription: string;
        oldUnitCost: number;
        newUnitCost: number;
      }>;
    };
    const groups = new Map<string, BudgetGroup>();

    for (const c of stale) {
      const bv = c.obraItem.budgetVersion;
      if (!groups.has(bv.id)) {
        groups.set(bv.id, {
          budgetId: bv.id,
          version: bv.version,
          projectId: bv.project.id,
          projectName: bv.project.name,
          date: bv.date,
          components: [],
        });
      }
      groups.get(bv.id)!.components.push({
        componentId: c.id,
        itemName: c.obraItem.name,
        itemNumber: c.obraItem.itemNumber,
        oldDescription: c.description,
        newDescription: c.material!.name,
        oldUnitCost: c.unitCost,
        newUnitCost: c.material!.netPrice,
      });
    }

    const result = Array.from(groups.values()).sort((a, b) =>
      a.projectName.localeCompare(b.projectName)
    );

    const totalDiffWithCatalog = missingCount + orphanCount;
    const allBudgetIds = new Set([...groups.keys(), ...budgetIdsWithDiff]);

    return NextResponse.json({
      totalStaleComponents: stale.length + totalDiffWithCatalog,
      staleMaterialComponents: stale.length,
      missingFromCatalog: missingCount,
      orphanedFromCatalog: orphanCount,
      budgetsAffected: allBudgetIds.size,
      groups: result,
      // Lista granular para el panel del editor (acepta/rechaza cambio por
      // cambio). Filtrada por customizado/congelado: es exactamente lo que el
      // endpoint `aplicar` está dispuesto a tocar.
      changes,
    });
  } catch (error) {
    console.error("Error en auditoría:", error);
    return NextResponse.json({ error: "Error en auditoría" }, { status: 500 });
  }
}
