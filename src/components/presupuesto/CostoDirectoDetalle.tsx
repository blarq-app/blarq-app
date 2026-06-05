"use client";

import { useState } from "react";
import { formatCLP } from "@/lib/utils";

// Vista de "Detalle por costo directo": agrupa los ObraItemComponent de
// todos los items del presupuesto por tipo (Materiales, Mano de obra,
// Herramientas, Subcontratos, Pérdidas, Margen) y muestra, dentro de cada
// tipo, una fila por componente (agrupando por materialId si existe, sino
// por descripción normalizada). Cada fila se puede expandir para ver en
// qué partidas aparece.
//
// Las agregaciones de qty solo son fiables si todas las apariciones del
// componente comparten la misma unit (kg con kg, m2 con m2). Si difieren,
// qty y costo unitario quedan en "—" y solo se muestra el total en $.

interface Component {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  materialId: string | null;
}

interface ItemLite {
  id: string;
  itemNumber: string;
  name: string;
  quantity: number;
  components: Component[];
}

interface Usage {
  itemId: string;
  itemNumber: string;
  itemName: string;
  itemQuantity: number;
  componentQuantity: number;
  unit: string;
  unitCost: number;
  // total para una unidad de la partida (componentQuantity × unitCost)
  unitContribution: number;
  // total real considerando la qty de la partida
  totalContribution: number;
}

interface Group {
  key: string;
  description: string;
  // unit común si todas coinciden, null si difieren entre apariciones
  unit: string | null;
  // qty agregada considerando la cantidad de cada partida; null si units difieren
  totalQuantity: number | null;
  // costo unitario representativo. Si todas las unitCost coinciden, ese
  // valor; si no, null. Mostrar siempre con cuidado: puede ser "promedio"
  // ponderado si hay variación pequeña por redondeo.
  unitCostRef: number | null;
  totalAmount: number;
  usages: Usage[];
}

const TYPE_ORDER: { type: string; label: string }[] = [
  { type: "material", label: "Materiales" },
  { type: "mano_obra", label: "Mano de obra" },
  { type: "herramientas", label: "Herramientas" },
  { type: "subcontrato", label: "Subcontrato" },
  { type: "perdida", label: "Pérdidas" },
  { type: "margen", label: "Margen" },
];

function normalizeKey(c: Component): string {
  // Si tiene materialId, agrupamos por ese ID — es la fuente de verdad
  // (el mismo material puede tener descripciones levemente distintas
  // entre partidas y aún así ser lo mismo).
  if (c.materialId) return `mat:${c.materialId}`;
  // Sino, agrupamos por descripción normalizada + tipo de unidad. Así si
  // "Cemento" aparece como m3 en una partida y kg en otra, quedan
  // separados (no sumar peras con manzanas).
  const desc = c.description.trim().toLowerCase().replace(/\s+/g, " ");
  return `desc:${desc}|${c.unit}`;
}

function buildGroups(items: ItemLite[]) {
  const byType: Record<string, Map<string, Group>> = {};
  for (const { type } of TYPE_ORDER) byType[type] = new Map();

  for (const item of items) {
    for (const c of item.components) {
      const bucket = byType[c.type];
      if (!bucket) continue; // tipo desconocido — lo ignoramos
      const key = normalizeKey(c);
      const usage: Usage = {
        itemId: item.id,
        itemNumber: item.itemNumber,
        itemName: item.name,
        itemQuantity: item.quantity,
        componentQuantity: c.quantity,
        unit: c.unit,
        unitCost: c.unitCost,
        unitContribution: c.totalCost, // ya es qty × unitCost
        totalContribution: c.totalCost * item.quantity,
      };
      const existing = bucket.get(key);
      if (existing) {
        existing.usages.push(usage);
        existing.totalAmount += usage.totalContribution;
      } else {
        bucket.set(key, {
          key,
          description: c.description,
          unit: c.unit,
          totalQuantity: c.quantity * item.quantity,
          unitCostRef: c.unitCost,
          totalAmount: usage.totalContribution,
          usages: [usage],
        });
      }
    }
  }

  // Post-procesamiento: si dentro de un grupo aparecen units distintas o
  // unitCosts distintos, marcar como "—". Sino, recalcular qty/unitCost.
  for (const type of Object.keys(byType)) {
    for (const g of byType[type].values()) {
      const allSameUnit = g.usages.every((u) => u.unit === g.usages[0].unit);
      const allSameCost = g.usages.every(
        (u) => Math.abs(u.unitCost - g.usages[0].unitCost) < 0.5
      );
      if (allSameUnit) {
        g.unit = g.usages[0].unit;
        g.totalQuantity = g.usages.reduce(
          (s, u) => s + u.componentQuantity * u.itemQuantity,
          0
        );
      } else {
        g.unit = null;
        g.totalQuantity = null;
      }
      g.unitCostRef = allSameCost ? g.usages[0].unitCost : null;
    }
  }

  return TYPE_ORDER.map(({ type, label }) => {
    const groups = Array.from(byType[type].values()).sort(
      (a, b) => b.totalAmount - a.totalAmount
    );
    const total = groups.reduce((s, g) => s + g.totalAmount, 0);
    return { type, label, groups, total };
  });
}

function formatQty(q: number | null, unit: string | null): string {
  if (q === null || unit === null) return "—";
  // Mostrar enteros sin decimales, decimales con hasta 2.
  const rounded = Math.round(q * 100) / 100;
  const txt =
    rounded === Math.trunc(rounded)
      ? rounded.toLocaleString("es-CL")
      : rounded.toLocaleString("es-CL", { maximumFractionDigits: 2 });
  return `${txt} ${unit}`;
}

export default function CostoDirectoDetalle({ items }: { items: ItemLite[] }) {
  const sections = buildGroups(items);
  const grandTotal = sections.reduce((s, sec) => s + sec.total, 0);
  const hasAnyComponent = grandTotal > 0;

  // Apertura por SECCIÓN (Materiales, Mano de obra, …). Cada sección se puede
  // colapsar con su flechita; el botón global abre/cierra todas a la vez.
  // (El desglose "en qué partidas aparece" de cada fila queda aparte, como
  // <details> nativo por fila.) Default: todas abiertas.
  const sectionTypes = sections.filter((s) => s.groups.length > 0).map((s) => s.type);
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});
  const allOpen = sectionTypes.every((t) => !closedSections[t]);
  function toggleAll() {
    if (allOpen) {
      // cerrar todas
      setClosedSections(Object.fromEntries(sectionTypes.map((t) => [t, true])));
    } else {
      // abrir todas
      setClosedSections({});
    }
  }
  function setSectionOpen(type: string, open: boolean) {
    setClosedSections((m) => {
      const isClosed = !!m[type];
      if (isClosed === !open) return m;
      return { ...m, [type]: !open };
    });
  }

  if (!hasAnyComponent) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Detalle por costo directo
        </h2>
        <p className="text-sm text-gray-500">
          Las partidas de este presupuesto todavía no tienen componentes
          cargados. Cuando agregues partidas desde el catálogo o edites
          componentes en el desglose de cada partida, vas a verlos acá
          agrupados por tipo.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Detalle por costo directo
        </h2>
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[10px] text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-400 rounded px-2 py-0.5 transition-colors whitespace-nowrap"
            title="Colapsa o despliega todas las secciones (Materiales, Mano de obra, …) a la vez"
          >
            {allOpen ? "Ocultar todo" : "Mostrar todo"}
          </button>
          <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
            Total componentes: {formatCLP(grandTotal)}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mb-2">
        Qué se está comprando dentro de cada tipo de costo. Click en una fila
        para ver en qué partidas aparece.
      </p>

      <div className="space-y-2">
        {sections.map((sec) => {
          if (sec.groups.length === 0) return null;
          const pct = grandTotal > 0 ? (sec.total / grandTotal) * 100 : 0;
          return (
            <details
              key={sec.type}
              className="border border-gray-200 rounded-lg overflow-hidden"
              open={!closedSections[sec.type]}
              onToggle={(e) => setSectionOpen(sec.type, e.currentTarget.open)}
            >
              <summary className="cursor-pointer flex items-center justify-between px-2.5 py-1 bg-gray-50 hover:bg-gray-100 transition-colors list-none [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-1.5">
                  {/* Flechita para ocultar/desplegar toda la sección.
                      Rota según el estado (controlado), no por group-open,
                      para no chocar con la flechita por fila (anidada). */}
                  <span
                    className={`text-gray-400 transition-transform inline-block text-[10px] leading-none ${
                      closedSections[sec.type] ? "" : "rotate-90"
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-[11px] font-semibold text-gray-900">
                    {sec.label}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    {sec.groups.length} {sec.groups.length === 1 ? "ítem" : "ítems"}
                  </span>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-[9px] text-gray-400 w-9 text-right">
                    {pct.toFixed(0)}%
                  </span>
                  <span className="text-[11px] font-medium text-gray-900 w-28 text-right">
                    {formatCLP(sec.total)}
                  </span>
                </div>
              </summary>

              <div className="overflow-x-auto">
                <table className="w-full text-[11px] leading-tight">
                  <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-t border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-1 font-medium">Descripción</th>
                      <th className="text-right px-2 py-1 font-medium">Cant. total</th>
                      <th className="text-right px-2 py-1 font-medium">Costo unit.</th>
                      <th className="text-right px-3 py-1 font-medium">Total</th>
                      <th className="text-right px-2 py-1 font-medium">% sección</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.groups.map((g) => {
                      const pctSec =
                        sec.total > 0 ? (g.totalAmount / sec.total) * 100 : 0;
                      // Margen y Pérdidas son componentes derivados que se
                      // expresan como %. Sumar cantidades o promediar costos
                      // unitarios no tiene significado — solo el total $ es
                      // interpretable. Las columnas se rellenan con "—".
                      const isDerived = sec.type === "margen" || sec.type === "perdida";
                      return (
                        <tr
                          key={g.key}
                          className="border-t border-gray-100 align-top"
                        >
                          <td colSpan={5} className="p-0">
                            <details className="group">
                              <summary className="cursor-pointer grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-0.5 hover:bg-gray-50">
                                <div className="text-gray-900 pr-3 flex items-center gap-1.5">
                                  <span className="text-gray-300 group-open:rotate-90 transition-transform inline-block text-[10px]">
                                    ▶
                                  </span>
                                  <span>{g.description}</span>
                                  <span className="text-[10px] text-gray-400">
                                    ({g.usages.length}{" "}
                                    {g.usages.length === 1 ? "partida" : "partidas"})
                                  </span>
                                </div>
                                <div className="text-right tabular-nums text-gray-700 w-28">
                                  {isDerived
                                    ? "—"
                                    : formatQty(g.totalQuantity, g.unit)}
                                </div>
                                <div className="text-right tabular-nums text-gray-700 w-24">
                                  {isDerived
                                    ? "—"
                                    : g.unitCostRef !== null
                                      ? formatCLP(g.unitCostRef)
                                      : "—"}
                                </div>
                                <div className="text-right tabular-nums font-medium text-gray-900 w-28 pr-3">
                                  {formatCLP(g.totalAmount)}
                                </div>
                                <div className="text-right tabular-nums text-gray-400 w-12 text-[10px]">
                                  {pctSec.toFixed(0)}%
                                </div>
                              </summary>
                              <div className="px-3 pb-1.5 pt-0.5 bg-gray-50">
                                <table className="w-full text-[11px] leading-tight">
                                  <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                                    <tr>
                                      <th className="text-left py-0.5 font-medium">
                                        Partida
                                      </th>
                                      <th className="text-right py-0.5 px-2 font-medium">
                                        Cant. partida
                                      </th>
                                      <th className="text-right py-0.5 px-2 font-medium">
                                        Cant. comp.
                                      </th>
                                      <th className="text-right py-0.5 px-2 font-medium">
                                        Costo unit.
                                      </th>
                                      <th className="text-right py-0.5 font-medium">
                                        Total
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.usages.map((u, i) => (
                                      <tr
                                        key={u.itemId + "-" + i}
                                        className="border-t border-gray-200"
                                      >
                                        <td className="py-0.5 text-gray-700">
                                          <span className="text-gray-400 mr-1">
                                            {u.itemNumber}
                                          </span>
                                          {u.itemName}
                                        </td>
                                        <td className="text-right tabular-nums text-gray-600 py-0.5 px-2">
                                          {u.itemQuantity}
                                        </td>
                                        <td className="text-right tabular-nums text-gray-600 py-0.5 px-2">
                                          {u.componentQuantity} {u.unit}
                                        </td>
                                        <td className="text-right tabular-nums text-gray-600 py-0.5 px-2">
                                          {formatCLP(u.unitCost)}
                                        </td>
                                        <td className="text-right tabular-nums font-medium text-gray-900 py-0.5">
                                          {formatCLP(u.totalContribution)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
