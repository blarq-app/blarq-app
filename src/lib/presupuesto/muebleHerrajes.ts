/**
 * Cálculo del costo de una partida "HERRAJES" (MuebleItem.kind="herrajes") a
 * partir de sus líneas (MuebleHerraje).
 *
 * Regla (Fase 2 herrajes, decidida con MJ 2026-06-22):
 *   costDistributor = Σ(costNet × cantidad)         ← lo que paga BLARQ
 *   clientPriceNet  = costDistributor × (1 + margen)  ← margen default 0.20
 *   clientPriceIva  = clientPriceNet × 1.19            ← lo que ve el cliente
 *
 * El proveedor es por línea (se puede mezclar HBT/DPH); el costo de cada línea
 * está CONGELADO (snapshot) al momento de agregarla. La cantidad de la PARTIDA
 * (MuebleItem.quantity) se mantiene en 1 para herrajes: las cantidades reales
 * van por línea, así que costDistributor ya las incluye.
 *
 * Pura (sin BD) para poder testearla. La persistencia la hace el endpoint.
 */

export type HerrajeLineCost = {
  costNet: number;
  quantity: number;
};

export type HerrajeItemTotals = {
  costDistributor: number;
  clientPriceNet: number;
  clientPriceIva: number;
};

const IVA = 1.19;

// Margen por defecto de una partida de herrajes: 20% (el ×1,2 del Excel de MJ).
export const DEFAULT_HERRAJE_UTILITY = 0.2;

export function computeHerrajeItemTotals(
  lines: HerrajeLineCost[],
  utilityPercentage: number,
): HerrajeItemTotals {
  const costDistributor = lines.reduce(
    (sum, l) => sum + (l.costNet || 0) * (l.quantity || 0),
    0,
  );
  // Redondeamos al peso, igual que el resto de la cotización de muebles.
  const costDist = Math.round(costDistributor);
  const clientPriceNet = Math.round(costDist * (1 + (utilityPercentage || 0)));
  const clientPriceIva = Math.round(clientPriceNet * IVA);
  return {
    costDistributor: costDist,
    clientPriceNet,
    clientPriceIva,
  };
}

/**
 * Recalcula y PERSISTE los totales de una partida de herrajes a partir de sus
 * líneas actuales en la BD. Se llama después de agregar/editar/borrar una línea.
 * Usa el margen (utilityPercentage) que tenga el item. Devuelve el item
 * actualizado. Importa prisma acá para no atarlo al pure de arriba (testeable).
 */
import { prisma } from "@/lib/prisma";

export async function recomputeAndPersistHerrajeItem(itemId: string) {
  const item = await prisma.muebleItem.findUnique({
    where: { id: itemId },
    include: { herrajes: { select: { costNet: true, quantity: true } } },
  });
  if (!item) return null;
  // CON líneas del catálogo: el costo se deriva de la suma (modo itemizado).
  // SIN líneas: la partida es MANUAL (proveedor + total, igual que muebles) →
  // se respeta el costDistributor que cargó MJ; solo se recalculan neto/iva con
  // el margen. Así una misma partida HERRAJES sirve para los dos modos.
  let costDistributor: number;
  if (item.herrajes.length > 0) {
    costDistributor = computeHerrajeItemTotals(
      item.herrajes,
      item.utilityPercentage,
    ).costDistributor;
  } else {
    costDistributor = Math.round(item.costDistributor);
  }
  const clientPriceNet = Math.round(
    costDistributor * (1 + (item.utilityPercentage || 0)),
  );
  const clientPriceIva = Math.round(clientPriceNet * IVA);
  return prisma.muebleItem.update({
    where: { id: itemId },
    data: { costDistributor, clientPriceNet, clientPriceIva },
  });
}
