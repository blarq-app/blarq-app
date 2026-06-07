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

  if (comp.type === "perdida") {
    // Pérdida % sobre UN material concreto.
    if (comp.appliedToComponentId) {
      const target = all.find((c) => c.id === comp.appliedToComponentId);
      if (!target) return 0;
      return effectiveTotal(target, all) * (pct / 100);
    }
    // Pérdida % sobre TODOS los materiales (Paso 4): % sobre la suma de
    // todas las líneas de tipo material.
    if (comp.appliedToType === "material") {
      const matBase = all
        .filter((c) => c.type === "material" && c.id !== comp.id)
        .reduce((s, c) => s + effectiveTotal(c, all), 0);
      return matBase * (pct / 100);
    }
    // Pérdida % sin objetivo = $0 (no se asume sobre qué aplica).
    return 0;
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

/**
 * Convierte los montos globales (costMaterial, costLabor, etc.) de un ObraItem
 * en componentes equivalentes, UNA sola vez, cuando la partida todavía no tiene
 * ningún componente detallado.
 *
 * Por qué existe: muchas partidas viejas se cargaron con el costo "en bruto"
 * (un solo número por tipo: Mano de obra $2.500) sin lista de materiales. En el
 * momento en que MJ empieza a detallar (agrega su primer material), el recálculo
 * pasa a derivar TODOS los montos desde los componentes — y como no había
 * componente de mano de obra, el $2.500 se iría a $0 sin aviso.
 *
 * Para evitar esa pérdida silenciosa, sembramos primero una línea por cada
 * monto global no-cero, etiquetada "(monto original)". El total de la partida
 * queda IDÉNTICO (la suma de las líneas sembradas = la suma de los montos
 * globales). MJ puede después editar o borrar cada línea con total control.
 *
 * Idempotente: si la partida ya tiene componentes, no hace nada.
 * Devuelve true si sembró algo.
 */
export async function seedObraItemComponentsFromLumps(
  obraItemId: string
): Promise<boolean> {
  const existing = await prisma.obraItemComponent.count({
    where: { obraItemId },
  });
  if (existing > 0) return false;

  const item = await prisma.obraItem.findUnique({
    where: { id: obraItemId },
    select: {
      costMaterial: true,
      costLabor: true,
      costTools: true,
      costSubcontract: true,
      costLoss: true,
      costMargin: true,
    },
  });
  if (!item) return false;

  // Costos directos (material, MO, herramientas, subcontrato, pérdida) se
  // siembran como MONTO FIJO: son la plata real de la partida.
  const fixedLumps: Array<{ type: string; amount: number; label: string }> = [
    { type: "material", amount: item.costMaterial ?? 0, label: "Materiales (monto original)" },
    { type: "mano_obra", amount: item.costLabor ?? 0, label: "Mano de obra (monto original)" },
    { type: "herramientas", amount: item.costTools ?? 0, label: "Herramientas (monto original)" },
    { type: "subcontrato", amount: item.costSubcontract ?? 0, label: "Subcontrato (monto original)" },
    { type: "perdida", amount: item.costLoss ?? 0, label: "Pérdida (monto original)" },
  ].filter((l) => l.amount && l.amount !== 0);

  // El MARGEN es un recargo % sobre el costo directo, no un monto fijo. Se
  // siembra como % para que CREZCA cuando MJ agregue materiales (su pedido
  // 2026-06-01). El % se deriva del propio monto actual de la partida, así el
  // total de hoy NO cambia y solo escala bien hacia adelante.
  //   base = costo directo (todo menos margen y pérdida), igual que el
  //   recalc del margen en effectiveTotal().
  const margin = item.costMargin ?? 0;
  const marginBase =
    (item.costMaterial ?? 0) +
    (item.costLabor ?? 0) +
    (item.costTools ?? 0) +
    (item.costSubcontract ?? 0);

  const rows: Array<{
    type: string;
    description: string;
    unit: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }> = fixedLumps.map((l) => ({
    type: l.type,
    description: l.label,
    unit: "GL",
    quantity: 1,
    unitCost: l.amount,
    totalCost: l.amount,
  }));

  if (margin !== 0) {
    if (marginBase > 0) {
      // Margen como % del costo directo. quantity = % (lo que lee el recalc).
      const pct = (margin / marginBase) * 100;
      rows.push({
        type: "margen",
        description: "Margen (% original)",
        unit: "%",
        quantity: pct,
        unitCost: 0,
        totalCost: margin,
      });
    } else {
      // Sin base (todo el costo directo en cero) no se puede expresar como %;
      // se preserva como monto fijo para no perderlo.
      rows.push({
        type: "margen",
        description: "Margen (monto original)",
        unit: "GL",
        quantity: 1,
        unitCost: margin,
        totalCost: margin,
      });
    }
  }

  if (rows.length === 0) return false;

  await prisma.obraItemComponent.createMany({
    data: rows.map((r, i) => ({
      obraItemId,
      type: r.type,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      unitCost: r.unitCost,
      totalCost: r.totalCost,
      sortOrder: i,
      // Sembrado desde un monto puesto a mano → blindado contra sync masivo.
      isCustomized: true,
    })),
  });

  return true;
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
