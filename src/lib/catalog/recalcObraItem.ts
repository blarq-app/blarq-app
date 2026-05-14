/**
 * Recálculo de un ObraItem desde sus ObraItemComponent (snapshot por proyecto).
 *
 * Espejo de la lógica de PartidaCatalog, pero aplicada al snapshot que vive
 * dentro de un BudgetVersion. Se usa cuando:
 *   - Se sincroniza un material cambiado en MaterialCatalog hacia presupuestos
 *     en borrador.
 *   - MJ edita un componente del ítem manualmente desde el editor del proyecto.
 */

import { prisma } from "@/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";

function effectiveTotal(
  comp: ObraItemComponent,
  all: ObraItemComponent[]
): number {
  const pct = comp.quantity || 0;

  if (comp.unit !== "%") {
    return (comp.quantity || 0) * (comp.unitCost || 0);
  }

  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const target = all.find((c) => c.id === comp.appliedToComponentId);
    if (!target) return 0;
    return effectiveTotal(target, all) * (pct / 100);
  }

  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = all
      .filter(
        (c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }

  if (comp.type === "margen") {
    const base = all
      .filter(
        (c) =>
          c.id !== comp.id && c.type !== "margen" && c.type !== "perdida"
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }

  return (comp.quantity || 0) * (comp.unitCost || 0);
}

export async function recalcObraItemFromComponents(obraItemId: string) {
  const components = await prisma.obraItemComponent.findMany({
    where: { obraItemId },
  });
  if (components.length === 0) return;

  const item = await prisma.obraItem.findUnique({
    where: { id: obraItemId },
    select: { quantity: true },
  });
  if (!item) return;

  const componentTotals = components.map((c) => ({
    id: c.id,
    totalCost: effectiveTotal(c, components),
  }));
  const totalByType = (type: string) =>
    components
      .filter((c) => c.type === type)
      .reduce(
        (s, c) =>
          s + (componentTotals.find((t) => t.id === c.id)?.totalCost ?? 0),
        0
      );

  const unitPrice = componentTotals.reduce((s, t) => s + t.totalCost, 0);
  const total = unitPrice * (item.quantity ?? 0);

  await prisma.$transaction([
    ...componentTotals.map((t) =>
      prisma.obraItemComponent.update({
        where: { id: t.id },
        data: { totalCost: t.totalCost },
      })
    ),
    prisma.obraItem.update({
      where: { id: obraItemId },
      data: {
        unitPrice,
        total,
        costMaterial: totalByType("material"),
        costLabor: totalByType("mano_obra"),
        costTools: totalByType("herramientas"),
        costMargin: totalByType("margen"),
        costLoss: totalByType("perdida"),
        costSubcontract: totalByType("subcontrato"),
        // No tocamos isCustomized acá — el caller decide. Sync masivo
        // de materiales NO lo marca custom; edición manual de un
        // componente SÍ lo marca.
      },
    }),
  ]);
}
