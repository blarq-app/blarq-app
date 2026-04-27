/**
 * Lógica de cálculo del Estado de Pago.
 *
 * Principio fundamental:
 *   `quantityExecuted` (cantidad ejecutada acumulada al final de un EP) es el
 *   dato base. El % se deriva. El monto pagado en EPs ya cerrados es
 *   inmutable (`amountPaid`).
 *
 * Esto blinda contra cambios de versión del presupuesto: si V2 sube los m²
 * totales o el precio, el monto histórico ya pagado no se recalcula.
 */

export interface EPItemSnapshot {
  /** Cantidad presupuestada vigente (refrescable por sync) */
  quantity: number;
  /** Precio unitario MO vigente (refrescable por sync) */
  laborUnitPrice: number;
  /** Cantidad ejecutada acumulada al final de este EP (editable mientras borrador) */
  quantityExecuted: number;
  /** Suma de quantityExecuted de la misma partida en EPs cerrados anteriores */
  prevExecutedQuantity: number;
  /** Suma de amountPaid de la misma partida en EPs cerrados anteriores (inmutable) */
  prevAmountPaid: number;
  /** True si la partida fue eliminada en una versión nueva del presupuesto pero ya tiene pagos */
  outOfScope?: boolean;
}

export interface EPItemComputed {
  /** Total MO referencial = quantity × laborUnitPrice */
  totalMo: number;
  /** % acumulado anterior (de EPs cerrados) — clamped 0..100 */
  pctAccumulatedPrev: number;
  /** % acumulado este EP — clamped 0..100 */
  pctAccumulatedCurrent: number;
  /** Cantidad nueva ejecutada en este EP = quantityExecuted - prevExecutedQuantity */
  newQuantityThisEp: number;
  /** Monto a pagar este EP = newQuantityThisEp × laborUnitPrice */
  amountThisEp: number;
  /** Monto total acumulado (incluye este EP) — referencial */
  totalAccumulated: number;
  /** Hay alerta: cantidad ejecutada > cantidad presupuestada vigente */
  warningExceedsTotal: boolean;
  /** Hay alerta: cantidad ejecutada < anterior (sólo se ve si datos inconsistentes) */
  warningBelowPrev: boolean;
}

/**
 * Calcula los valores derivados de una partida del EP. Función pura.
 */
export function computeEPItem(snap: EPItemSnapshot): EPItemComputed {
  const totalMo = snap.quantity * snap.laborUnitPrice;
  const pctAccumulatedPrev = snap.quantity > 0
    ? clamp((snap.prevExecutedQuantity / snap.quantity) * 100, 0, 100)
    : 0;
  const pctAccumulatedCurrent = snap.quantity > 0
    ? clamp((snap.quantityExecuted / snap.quantity) * 100, 0, 100)
    : 0;
  const newQuantityThisEp = Math.max(0, snap.quantityExecuted - snap.prevExecutedQuantity);
  const amountThisEp = newQuantityThisEp * snap.laborUnitPrice;
  const totalAccumulated = snap.prevAmountPaid + amountThisEp;
  return {
    totalMo,
    pctAccumulatedPrev,
    pctAccumulatedCurrent,
    newQuantityThisEp,
    amountThisEp,
    totalAccumulated,
    warningExceedsTotal: snap.quantityExecuted > snap.quantity + 0.0001,
    warningBelowPrev: snap.quantityExecuted < snap.prevExecutedQuantity - 0.0001,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Valida si una nueva cantidad ejecutada es admisible. Devuelve null si OK,
 * o un mensaje explicativo si no.
 */
export function validateQuantityExecuted(
  newValue: number,
  snap: { prevExecutedQuantity: number; quantity: number; outOfScope?: boolean }
): string | null {
  if (snap.outOfScope) {
    return "Esta partida quedó fuera de alcance en la versión actual del presupuesto. Su cantidad ejecutada no puede cambiar.";
  }
  if (Number.isNaN(newValue) || newValue < 0) {
    return "La cantidad debe ser un número mayor o igual a 0.";
  }
  if (newValue < snap.prevExecutedQuantity - 0.0001) {
    return `No se puede reducir la cantidad ejecutada por debajo de la del EP anterior cerrado (${snap.prevExecutedQuantity}). Esa cantidad ya fue pagada al maestro. Si hubo un cambio de alcance, el presupuesto debe pasar a una nueva versión y luego sincronizar este EP.`;
  }
  if (newValue > snap.quantity + 0.0001) {
    return `No se puede ejecutar más cantidad que la presupuestada (${snap.quantity}). Si la obra requiere más, pedile al profesional a cargo que actualice el presupuesto a una nueva versión y luego sincronizá este EP.`;
  }
  return null;
}

/**
 * Convierte un % a cantidad equivalente (cuando el usuario edita el % en lugar de cantidad).
 */
export function pctToQuantity(pct: number, totalQuantity: number): number {
  return clamp(pct, 0, 100) * totalQuantity / 100;
}

/**
 * Suma totales del EP completo.
 */
export function sumEPTotals(items: EPItemSnapshot[]) {
  let totalMoBudget = 0;
  let totalAmountThisEp = 0;
  let totalAmountAccumulatedPrev = 0;
  for (const it of items) {
    const c = computeEPItem(it);
    totalMoBudget += c.totalMo;
    totalAmountThisEp += c.amountThisEp;
    totalAmountAccumulatedPrev += it.prevAmountPaid;
  }
  return {
    totalMoBudget,
    totalAmountThisEp,
    totalAmountAccumulatedPrev,
    totalAmountAccumulatedAfterThisEp: totalAmountAccumulatedPrev + totalAmountThisEp,
    saldoPorPagar: totalMoBudget - (totalAmountAccumulatedPrev + totalAmountThisEp),
  };
}
