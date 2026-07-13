/**
 * Lista de Compra: incluir la PÉRDIDA (merma) en la CANTIDAD física a comprar.
 *
 * Problema que resuelve (verificado 2026-07-13): la pérdida de una partida se
 * modela como un componente `type: "perdida"` que suma en PLATA (% sobre el
 * costo de los materiales). Pero la Lista de Compra mostraba la cubicación
 * "pelada" — los m² sin merma —, así que MJ podía terminar comprando de menos.
 *
 * Este módulo es la ÚNICA fuente de verdad de cómo la pérdida infla la cantidad,
 * usada por los tres lugares que arman la lista (la página en vivo, el PDF y el
 * sync de ShoppingItem). Antes cada uno repetía el mismo loop; centralizar acá
 * evita que se desincronicen.
 *
 * Alcance (decisión MJ 2026-07-13): aplica a TODOS los presupuestos, sin corte
 * de fecha. Pero solo mueve los m² de una partida cuando la pérdida está
 * enganchada a un material (ver materialLossFactor). Las pérdidas como monto
 * fijo (proyectos viejos) o sin asignar no inflan nada → el resto de los
 * proyectos queda igual solo. Los únicos con pérdida en % asignada hoy son
 * Cocina Candelaria (se arregla, aún no enviado) y Depto Colon (entregado/
 * rechazado, ya no se compra → da lo mismo).
 */

import type { ObraItemComponent } from "@prisma/client";

/**
 * Factor de merma sobre la cantidad física de UN material dentro de una partida.
 * Espeja la lógica de PLATA de `recalcObraItem.effectiveTotal`, pero para metros.
 *
 * Suma los % de las líneas `type: "perdida"` con `unit: "%"` que apuntan a este
 * material:
 *   - `appliedToComponentId === material.id` → pérdida específica de ese material.
 *   - `appliedToType === "material"` (sin componente) → "Todos los materiales".
 * Devuelve `(1 + Σ%/100)`. Sin pérdida enganchada → 1 (cantidad pelada).
 *
 * Las pérdidas viejas como monto fijo (`unit != "%"`, "Pérdida (monto original)")
 * no tienen % → no inflan la cantidad. Eso, sumado al corte de fecha, deja los
 * proyectos ya armados sin cambios.
 */
export function materialLossFactor(
  material: Pick<ObraItemComponent, "id">,
  all: Pick<
    ObraItemComponent,
    "type" | "unit" | "quantity" | "appliedToComponentId" | "appliedToType"
  >[]
): number {
  let pct = 0;
  for (const c of all) {
    if (c.type !== "perdida" || c.unit !== "%") continue;
    const q = c.quantity || 0;
    if (q <= 0) continue;
    const aplicaAEste = c.appliedToComponentId === material.id;
    const aplicaATodos =
      !c.appliedToComponentId && c.appliedToType === "material";
    if (aplicaAEste || aplicaATodos) pct += q;
  }
  return 1 + pct / 100;
}

// Forma mínima de un material del catálogo tal como lo consume la lista.
type MaterialRel = {
  name: string;
  unit: string;
  isProvision?: boolean | null;
  referenceLink?: string | null;
} | null;

type CompForShopping = Pick<
  ObraItemComponent,
  | "id"
  | "type"
  | "unit"
  | "quantity"
  | "unitCost"
  | "description"
  | "materialId"
  | "appliedToComponentId"
  | "appliedToType"
> & { material?: MaterialRel };

type ObraItemForShopping = {
  name: string;
  quantity: number | null;
  components: CompForShopping[];
};

export type ShoppingAgg = {
  key: string;
  name: string;
  unit: string;
  materialId: string | null;
  qtyNeeded: number;
  totalBudgeted: number;
  partidas: Set<string>;
  referenceLink: string | null;
  isProvision: boolean;
};

/**
 * Agrega los materiales de todas las partidas de un presupuesto en filas de
 * lista de compra. `applyLoss` decide si la cantidad incluye la merma (ver
 * `listaCompraIncluyePerdida`). La clave de agregación es `materialId` o, si no
 * hay, `nombre+unidad` normalizados — igual que antes.
 */
export function aggregateShoppingItems(
  obraItems: ObraItemForShopping[],
  applyLoss: boolean
): Map<string, ShoppingAgg> {
  const agg = new Map<string, ShoppingAgg>();

  for (const obraItem of obraItems) {
    const comps = obraItem.components;
    for (const c of comps) {
      if (c.type !== "material") continue;
      const factor = applyLoss ? materialLossFactor(c, comps) : 1;
      const qty = (c.quantity || 0) * (obraItem.quantity || 0) * factor;
      if (qty <= 0) continue;
      const budgeted = (c.unitCost || 0) * qty;
      const name = c.material?.name || c.description;
      const unit = c.material?.unit || c.unit;
      const key = c.materialId
        ? `mat:${c.materialId}`
        : `name:${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
      const prev = agg.get(key);
      if (prev) {
        prev.qtyNeeded += qty;
        prev.totalBudgeted += budgeted;
        prev.partidas.add(obraItem.name);
      } else {
        agg.set(key, {
          key,
          name,
          unit,
          materialId: c.materialId || null,
          qtyNeeded: qty,
          totalBudgeted: budgeted,
          partidas: new Set([obraItem.name]),
          referenceLink: c.material?.referenceLink || null,
          isProvision: !!c.material?.isProvision,
        });
      }
    }
  }

  return agg;
}

/**
 * Cuenta partidas con plata de material presupuestada pero sin materiales
 * detallados (no aparecen en la lista). Antes se detectaba con
 * `components.length === 0` porque la query filtraba a material; ahora que
 * traemos TODOS los componentes hay que filtrar por tipo material explícito.
 */
export function countItemsWithoutMaterial(
  obraItems: (ObraItemForShopping & { costMaterial?: number | null })[],
  requireBudgetedMaterial: boolean
): number {
  return obraItems.filter((i) => {
    const sinMaterial =
      i.components.filter((c) => c.type === "material").length === 0;
    if (!sinMaterial) return false;
    return requireBudgetedMaterial ? (i.costMaterial ?? 0) > 0 : true;
  }).length;
}
