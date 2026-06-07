/**
 * Recálculo de totales de PartidaCatalog desde sus componentes.
 *
 * Espejo de la lógica `effectiveTotal()` que vive en el front
 * (src/components/catalogo/PartidaSearch.tsx). Se duplica acá porque
 * el sync automático con MaterialCatalog y el script de Fase 0 corren
 * desde backend/scripts y necesitan recalcular sin pasar por la UI.
 *
 * Cualquier cambio a la fórmula debe hacerse en AMBOS lados.
 */

import { prisma } from "@/lib/prisma";
import type { PartidaComponent } from "@prisma/client";

// Suma efectiva de un componente, aplicando la lógica de % (pérdida sobre
// material, leyes sobre MO, margen sobre todo el resto).
export function effectiveTotal(
  comp: PartidaComponent,
  all: PartidaComponent[]
): number {
  const active = all;
  const pct = comp.quantity || 0;

  if (comp.unit !== "%") {
    return (comp.quantity || 0) * (comp.unitCost || 0);
  }

  if (comp.type === "perdida") {
    // Pérdida % sobre UN material concreto.
    if (comp.appliedToComponentId) {
      const target = active.find((c) => c.id === comp.appliedToComponentId);
      if (!target) return 0;
      return effectiveTotal(target, all) * (pct / 100);
    }
    // Pérdida % sobre TODOS los materiales (Paso 4): % sobre la suma de
    // todas las líneas de tipo material.
    if (comp.appliedToType === "material") {
      const matBase = active
        .filter((c) => c.type === "material" && c.id !== comp.id)
        .reduce((s, c) => s + effectiveTotal(c, all), 0);
      return matBase * (pct / 100);
    }
    // Pérdida % sin objetivo = $0.
    return 0;
  }

  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = active
      .filter(
        (c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }

  if (comp.type === "margen") {
    const base = active
      .filter(
        (c) =>
          c.id !== comp.id && c.type !== "margen" && c.type !== "perdida"
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }

  return (comp.quantity || 0) * (comp.unitCost || 0);
}

interface RecalcResult {
  unitPrice: number;
  costMaterial: number;
  costLabor: number;
  costTools: number;
  costMargin: number;
  costLoss: number;
  costSubcontract: number;
  componentTotals: Array<{ id: string; totalCost: number }>;
}

// Calcula totales desde los componentes — uso puro, sin escribir BD.
export function computePartidaTotalsFromComponents(
  components: PartidaComponent[]
): RecalcResult {
  const componentTotals = components.map((c) => ({
    id: c.id,
    totalCost: effectiveTotal(c, components),
  }));

  const totalByType = (type: string) =>
    components
      .filter((c) => c.type === type)
      .reduce(
        (s, c) => s + (componentTotals.find((t) => t.id === c.id)?.totalCost ?? 0),
        0
      );

  const unitPrice = componentTotals.reduce((s, t) => s + t.totalCost, 0);

  return {
    unitPrice,
    costMaterial: totalByType("material"),
    costLabor: totalByType("mano_obra"),
    costTools: totalByType("herramientas"),
    costMargin: totalByType("margen"),
    costLoss: totalByType("perdida"),
    costSubcontract: totalByType("subcontrato"),
    componentTotals,
  };
}

/**
 * Re-lee los componentes de una partida, calcula los totales efectivos y
 * persiste:
 *   - PartidaComponent.totalCost de cada componente
 *   - PartidaCatalog.unitPrice y cost* agregados
 *
 * Idempotente: se puede correr múltiples veces sin efectos colaterales.
 */
export async function recalcPartidaTotals(partidaId: string): Promise<RecalcResult> {
  const components = await prisma.partidaComponent.findMany({
    where: { partidaId },
  });

  const result = computePartidaTotalsFromComponents(components);

  await prisma.$transaction([
    ...result.componentTotals.map((t) =>
      prisma.partidaComponent.update({
        where: { id: t.id },
        data: { totalCost: t.totalCost },
      })
    ),
    prisma.partidaCatalog.update({
      where: { id: partidaId },
      data: {
        unitPrice: result.unitPrice,
        costMaterial: result.costMaterial,
        costLabor: result.costLabor,
        costTools: result.costTools,
        costMargin: result.costMargin,
        costLoss: result.costLoss,
        costSubcontract: result.costSubcontract,
      },
    }),
  ]);

  return result;
}
