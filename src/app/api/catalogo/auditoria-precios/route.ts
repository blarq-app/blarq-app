/**
 * Auditoría de precios desactualizados.
 *
 * GET: detecta tres tipos de desactualización en presupuestos status="borrador":
 *      (a) componentes existentes cuyo unitCost/description difiere del
 *          MaterialCatalog linkeado (stale).
 *      (b) componentes del catálogo de partidas que faltan en el ObraItem
 *          (missing) — pasaron a existir después de copiar la partida.
 *      (c) componentes del proyecto cuyo origen ya no está en el catálogo
 *          (orphan) — se borraron del catálogo después.
 *      Solo cuenta componentes/partidas que NO están customizados.
 *      Agrupado por proyecto + presupuesto.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Si se pasa ?budgetId=xxx limitamos al presupuesto puntual (lo usa el
    // cartelito del editor de presupuesto). Sin parámetro, lista todos los
    // borradores con stale components (para la página /configuracion/auditoria-precios).
    const budgetId = request.nextUrl.searchParams.get("budgetId");

    // Solo borradores. Status enviado/aprobado/rechazado están congelados.
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
            budgetVersion: {
              select: {
                id: true,
                version: true,
                date: true,
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

    // ── Detectar diferencias con el catálogo de partidas ──────────────
    // (a) Componentes del catálogo que faltan en el ObraItem.
    // (b) Componentes del ObraItem cuyo origen ya no existe en el catálogo.
    // Solo consideramos ObraItems en borrador, con catalogPartidaId y no
    // customizados (a nivel partida).
    const obraItemsBudget = await prisma.obraItem.findMany({
      where: {
        budgetVersionId: budgetId ?? undefined,
        budgetVersion: { status: "borrador" },
        catalogPartidaId: { not: null },
        isCustomized: false,
      },
      select: {
        id: true,
        catalogPartidaId: true,
        budgetVersionId: true,
        lineageId: true,
        budgetVersion: {
          select: { projectId: true, type: true },
        },
        components: {
          select: {
            originComponentId: true,
            type: true,
            description: true,
            unit: true,
            materialId: true,
          },
        },
        discardedCatalogComponents: { select: { partidaComponentId: true } },
      },
    });

    // Lineage congelado por contrato: partidas que ya viajaron en una
    // versión enviada/aprobada del mismo proyecto+tipo. Aunque aparezcan
    // en una V2 borrador (porque V2 se duplicó de V1), no se sincronizan.
    // Construimos el set por (projectId, type) para reutilizar entre items.
    const frozenByKey = new Map<string, Set<string>>();
    for (const oi of obraItemsBudget) {
      const key = `${oi.budgetVersion.projectId}|${oi.budgetVersion.type}`;
      if (!frozenByKey.has(key)) {
        const heredadas = await prisma.obraItem.findMany({
          where: {
            budgetVersion: {
              projectId: oi.budgetVersion.projectId,
              type: oi.budgetVersion.type,
              status: { in: ["enviado", "aprobado"] },
            },
          },
          select: { lineageId: true },
          distinct: ["lineageId"],
        });
        frozenByKey.set(key, new Set(heredadas.map((h) => h.lineageId)));
      }
    }

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
      // mapeado (originComponentId=null en todos), no contamos diferencias —
      // el sync no agregaría/borraría nada para evitar duplicados.
      const legacyUnmapped =
        oi.components.length > 0 &&
        oi.components.every((c) => c.originComponentId === null);
      if (legacyUnmapped) continue;

      // Guarda por contrato: partida heredada de una versión enviada/aprobada.
      // Tampoco la mostramos como diferencia — el sync la respetaría.
      const frozenKey = `${oi.budgetVersion.projectId}|${oi.budgetVersion.type}`;
      if (frozenByKey.get(frozenKey)?.has(oi.lineageId)) continue;

      // Componentes huérfanos del proyecto (sin originComponentId) — los
      // usamos para descartar faltantes que ya están presentes por loose
      // match (mismo type+description+unit+materialId).
      const orphanProjectComps = oi.components.filter(
        (c) => c.originComponentId === null
      );
      const hasLooseMatch = (cat: typeof catalogComps[number]) =>
        orphanProjectComps.some(
          (p) =>
            p.type === cat.type &&
            p.unit === cat.unit &&
            (p.materialId ?? null) === (cat.materialId ?? null) &&
            p.description.trim().toLowerCase() ===
              cat.description.trim().toLowerCase()
        );

      // Faltantes: en catálogo, no mapeados al proyecto, no descartados,
      // y sin loose match con un componente huérfano del proyecto.
      let m = 0;
      for (const cat of catalogComps) {
        if (projectOriginIds.has(cat.id)) continue;
        if (discardedIds.has(cat.id)) continue;
        if (hasLooseMatch(cat)) continue;
        m++;
      }

      // Huérfanos: en proyecto con originComponentId, pero ese id no
      // existe en el catálogo.
      let o = 0;
      for (const c of oi.components) {
        if (!c.originComponentId) continue;
        if (!catalogIds.has(c.originComponentId)) o++;
      }

      missingCount += m;
      orphanCount += o;
      if (m + o > 0) budgetIdsWithDiff.add(oi.budgetVersionId);
    }

    // Agrupar por presupuesto
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

    // Total que dispara el banner: stale + faltantes + huérfanos. El banner
    // amarillo aparece si cualquiera de los tres es > 0.
    const totalDiffWithCatalog = missingCount + orphanCount;
    const allBudgetIds = new Set([...groups.keys(), ...budgetIdsWithDiff]);

    return NextResponse.json({
      totalStaleComponents: stale.length + totalDiffWithCatalog,
      // Desglose para depurar / mostrar en la página de auditoría:
      staleMaterialComponents: stale.length,
      missingFromCatalog: missingCount,
      orphanedFromCatalog: orphanCount,
      budgetsAffected: allBudgetIds.size,
      groups: result,
    });
  } catch (error) {
    console.error("Error en auditoría:", error);
    return NextResponse.json(
      { error: "Error en auditoría" },
      { status: 500 }
    );
  }
}
