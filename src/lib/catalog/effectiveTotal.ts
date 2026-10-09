/**
 * Monto efectivo de UNA línea del desglose de una partida de obra
 * (ObraItemComponent), por unidad de la partida.
 *
 * Vivía adentro de recalcObraItem.ts; se movió acá TAL CUAL (sin cambiar una
 * coma de la lógica) para poder usarlo sin base de datos: la conversión de una
 * partida a GL (lib/presupuesto/partidaGlobal.ts) necesita calcular el total
 * ANTES de escribir, con exactamente la misma cuenta que el recálculo, para
 * negarse si el total se moviera.
 *
 * Reglas:
 *   - Línea que no es "%": cantidad × costo.
 *   - Pérdida %: sobre un material concreto, o sobre todos los materiales; sin
 *     objetivo vale $0 (no se asume sobre qué aplica).
 *   - Mano de obra % con appliedToType "mano_obra" (leyes sociales): % de la
 *     mano de obra que no es %.
 *   - Margen %: % de todo lo que no es margen ni pérdida.
 *   - Cualquier otra línea "%" cae a cantidad × costo (dato viejo: hay leyes
 *     sociales en "%" sin objetivo, casi todas con cantidad 0).
 */

export interface ComponenteCalculable {
  id: string;
  type: string;
  unit: string;
  quantity: number;
  unitCost: number;
  appliedToComponentId: string | null;
  appliedToType: string | null;
}

export function effectiveTotal<C extends ComponenteCalculable>(
  comp: C,
  all: C[]
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

/** Precio por unidad de la partida = suma de los montos efectivos del desglose. */
export function precioPorUnidad<C extends ComponenteCalculable>(all: C[]): number {
  return all.reduce((s, c) => s + effectiveTotal(c, all), 0);
}

/**
 * ¿El monto de esta línea es un porcentaje de OTRAS líneas? Si lo es, cuando
 * las otras líneas crecen, esta crece sola en la misma proporción. Es el
 * espejo exacto de las ramas "%" de effectiveTotal que no caen a
 * cantidad × costo.
 */
export function esPorcentajeDeOtras(comp: ComponenteCalculable): boolean {
  if (comp.unit !== "%") return false;
  if (comp.type === "perdida") return true; // con objetivo escala; sin objetivo es $0
  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") return true;
  if (comp.type === "margen") return true;
  return false;
}
