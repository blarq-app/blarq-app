/**
 * Sincroniza componentes desactualizados en presupuestos borrador.
 *
 * POST sin body: sincroniza TODOS los materiales con componentes
 *      desactualizados en borradores (respeta isCustomized).
 * POST { budgetVersionId: "..." }: limita la sincronización a un
 *      presupuesto específico.
 */

import { prisma } from "@/lib/prisma";
import { syncMaterialToComponents } from "@/lib/catalog/syncMaterial";
import { NextRequest, NextResponse } from "next/server";
import { recalcObraItemFromComponents } from "@/lib/catalog/recalcObraItem";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      budgetVersionId?: string;
    };

    // Si MJ pasa budgetVersionId, sincronizamos solo los ObraItemComponent
    // de ese presupuesto, no propagamos a otros.
    if (body.budgetVersionId) {
      const bv = await prisma.budgetVersion.findUnique({
        where: { id: body.budgetVersionId },
        select: { status: true },
      });
      if (!bv) {
        return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
      }
      if (bv.status !== "borrador") {
        return NextResponse.json(
          { error: "Solo se pueden sincronizar presupuestos en borrador" },
          { status: 400 }
        );
      }

      const components = await prisma.obraItemComponent.findMany({
        where: {
          materialId: { not: null },
          isCustomized: false,
          obraItem: { budgetVersionId: body.budgetVersionId },
        },
        include: { material: true },
      });

      const obraItemIdsAffected = new Set<string>();
      let updated = 0;
      let skipped = 0;
      for (const c of components) {
        if (!c.material) continue;
        const isStale =
          c.description !== c.material.name ||
          Math.abs(c.unitCost - c.material.netPrice) > 0.01 ||
          (c.referenceLink ?? null) !== (c.material.referenceLink ?? null);
        if (!isStale) {
          skipped++;
          continue;
        }
        await prisma.obraItemComponent.update({
          where: { id: c.id },
          data: {
            description: c.material.name,
            unit: c.material.unit,
            unitCost: c.material.netPrice,
            referenceLink: c.material.referenceLink,
          },
        });
        updated++;
        obraItemIdsAffected.add(c.obraItemId);
      }
      for (const itemId of obraItemIdsAffected) {
        await recalcObraItemFromComponents(itemId);
      }

      return NextResponse.json({
        budgetVersionId: body.budgetVersionId,
        componentsUpdated: updated,
        componentsSkipped: skipped,
        obraItemsRecalculated: obraItemIdsAffected.size,
      });
    }

    // Modo global: para cada material con stale components en borradores,
    // correr syncMaterialToComponents con propagateToBudgets=true.
    const materials = await prisma.materialCatalog.findMany({
      where: {
        obraItemComponents: {
          some: {
            isCustomized: false,
            obraItem: { budgetVersion: { status: "borrador" } },
          },
        },
      },
      select: { id: true },
    });

    const totals = {
      partidaComponentsUpdated: 0,
      partidasRecalculated: 0,
      obraItemComponentsUpdated: 0,
      obraItemComponentsSkipped: 0,
      obraItemsRecalculated: 0,
      budgetVersionsAffected: 0,
    };
    for (const m of materials) {
      const s = await syncMaterialToComponents(m.id, {
        propagateToBudgets: true,
      });
      totals.partidaComponentsUpdated += s.partidaComponentsUpdated;
      totals.partidasRecalculated += s.partidasRecalculated;
      totals.obraItemComponentsUpdated += s.obraItemComponentsUpdated;
      totals.obraItemComponentsSkipped += s.obraItemComponentsSkipped;
      totals.obraItemsRecalculated += s.obraItemsRecalculated;
      totals.budgetVersionsAffected += s.budgetVersionsAffected;
    }

    return NextResponse.json(totals);
  } catch (error) {
    console.error("Error en sync:", error);
    return NextResponse.json({ error: "Error en sync" }, { status: 500 });
  }
}
