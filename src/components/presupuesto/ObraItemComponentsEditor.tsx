"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";
import MoneyInput from "@/components/ui/MoneyInput";
import MaterialAutocomplete from "@/components/catalogo/MaterialAutocomplete";

interface Material {
  id: string;
  name: string;
  unit: string;
  netPrice: number;
  referenceLink: string | null;
}

// Forma que devuelve el autocomplete de materiales del catálogo.
type CatalogMaterial = {
  id: string;
  name: string;
  category: string;
  unit: string;
  netPrice: number;
};

interface Component {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceLink: string | null;
  materialId: string | null;
  isCustomized: boolean;
  sortOrder: number;
  appliedToComponentId: string | null;
  appliedToType: string | null;
  material: Material | null;
}

const COMP_TYPES = [
  { value: "material", label: "Material", color: "bg-blue-50 text-blue-700" },
  { value: "mano_obra", label: "Mano de Obra", color: "bg-emerald-50 text-emerald-700" },
  { value: "herramientas", label: "Herramientas", color: "bg-amber-50 text-amber-700" },
  { value: "subcontrato", label: "Subcontrato", color: "bg-purple-50 text-purple-700" },
  { value: "perdida", label: "Pérdida", color: "bg-rose-50 text-rose-700" },
  { value: "margen", label: "Margen", color: "bg-fuchsia-50 text-fuchsia-700" },
];

function typeMeta(type: string) {
  return COMP_TYPES.find((t) => t.value === type) ?? COMP_TYPES[0];
}

// Orden visual fijo de la tabla editable: materiales arriba, margen abajo
// (mismo orden que COMP_TYPES y que la vista resumen "Detalle por costo
// directo"). Dentro de cada tipo se respeta sortOrder (orden de creación), así
// una línea NUEVA cae al final de su grupo y no al final de toda la tabla.
const TYPE_RANK: Record<string, number> = Object.fromEntries(
  COMP_TYPES.map((t, i) => [t.value, i])
);
function compareComps(
  a: { type: string; sortOrder: number },
  b: { type: string; sortOrder: number }
) {
  return (
    (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99) ||
    a.sortOrder - b.sortOrder
  );
}

// Orden de despliegue: como compareComps, pero cada línea de PÉRDIDA que se
// calcula sobre un material concreto (appliedToComponentId) se muestra JUSTO
// DEBAJO de ese material, no agrupada al final. Así se entiende visualmente
// sobre qué material aplica la pérdida. Las pérdidas sin material apuntado
// (appliedToComponentId null) se quedan en su grupo normal (orden por tipo).
function orderForDisplay(list: Component[]): Component[] {
  const anidadas = list.filter(
    (c) => c.type === "perdida" && c.appliedToComponentId
  );
  const base = list
    .filter((c) => !(c.type === "perdida" && c.appliedToComponentId))
    .sort(compareComps);
  const out: Component[] = [];
  const colocadas = new Set<string>();
  for (const c of base) {
    out.push(c);
    colocadas.add(c.id);
    for (const p of anidadas
      .filter((p) => p.appliedToComponentId === c.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push(p);
      colocadas.add(p.id);
    }
  }
  // Pérdidas cuyo material apuntado ya no existe en la lista → al final,
  // para no perderlas de vista.
  for (const p of anidadas) if (!colocadas.has(p.id)) out.push(p);
  return out;
}

// Unidades disponibles (mismas que el catálogo). "%" convierte la línea en un
// porcentaje: leyes sociales sobre la mano de obra, margen sobre el costo.
const UNIT_OPTIONS = ["UN", "M2", "ML", "M3", "KG", "GL", "DIA", "HR", "%"];

export default function ObraItemComponentsEditor({
  budgetId,
  itemId,
  canEdit,
  catalogPartidaId,
  onChanged,
  onCountChange,
  dense = false,
}: {
  budgetId: string;
  itemId: string;
  canEdit: boolean;
  // Si la partida viene del catálogo, habilita el botón "↑ al catálogo" por
  // línea. Si es null (partida 100% manual), no se muestra.
  catalogPartidaId?: string | null;
  onChanged?: () => void;
  // Reporta la cantidad de componentes cada vez que se (re)cargan. Lo usa el
  // panel para decidir si muestra la fila de totales (redundante con el
  // desglose) o no.
  onCountChange?: (count: number) => void;
  // Modo compacto: filas más bajas y letra más chica (vista densa estilo Excel).
  dense?: boolean;
}) {
  const [comps, setComps] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // Texto del buscador de materiales del catálogo.
  const [matQuery, setMatQuery] = useState("");
  // Línea recién subida al catálogo (para mostrar "✓ en catálogo" un momento).
  const [pushedId, setPushedId] = useState<string | null>(null);

  const fetchComps = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes`,
        { cache: "no-store" }
      );
      if (r.ok) {
        const data = await r.json();
        setComps(data);
        onCountChange?.(Array.isArray(data) ? data.length : 0);
      }
    } finally {
      setLoading(false);
    }
  }, [budgetId, itemId, onCountChange]);

  useEffect(() => {
    fetchComps();
  }, [fetchComps]);

  async function patchComp(compId: string, field: string, value: unknown) {
    setSaving(compId);
    // Optimista
    setComps((prev) =>
      prev.map((c) => (c.id === compId ? { ...c, [field]: value, isCustomized: true } : c))
    );
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes/${compId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        }
      );
      // Re-fetch para recibir el totalCost recalculado + propagación al ítem
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  // Editar varios campos de una línea de una sola vez (ej. al cambiar la
  // unidad a "%" también hay que ajustar appliedToType para que el % se
  // calcule sobre lo correcto).
  async function patchCompFields(compId: string, fields: Record<string, unknown>) {
    setSaving(compId);
    setComps((prev) =>
      prev.map((c) => (c.id === compId ? { ...c, ...fields, isCustomized: true } : c))
    );
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes/${compId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        }
      );
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  // Cambiar la unidad de una línea. Si pasa a "%":
  //   - mano de obra → leyes sociales (% sobre la mano de obra).
  //   - margen → % sobre el costo directo (sin appliedTo).
  // Si sale de "%", se limpian los appliedTo.
  function changeUnit(c: Component, newUnit: string) {
    const fields: Record<string, unknown> = { unit: newUnit };
    if (newUnit === "%") {
      fields.appliedToType = c.type === "mano_obra" ? "mano_obra" : null;
    } else {
      fields.appliedToType = null;
      fields.appliedToComponentId = null;
    }
    patchCompFields(c.id, fields);
  }

  // Agregar "leyes sociales" = mano de obra como % sobre la mano de obra.
  async function addLeyes() {
    setSaving("__new");
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mano_obra",
            description: "Leyes sociales",
            unit: "%",
            quantity: 30,
            unitCost: 0,
            appliedToType: "mano_obra",
            sortOrder: comps.length,
          }),
        }
      );
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  async function deleteComp(compId: string) {
    if (!confirm("¿Eliminar este componente?")) return;
    setSaving(compId);
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes/${compId}`,
        { method: "DELETE" }
      );
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  // Agregar un material elegido del catálogo: trae su precio neto y queda
  // enlazado por materialId (para futuros sync de precio).
  async function addMaterial(m: CatalogMaterial) {
    setSaving("__new");
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "material",
            description: m.name,
            unit: m.unit || "UN",
            quantity: 1,
            unitCost: m.netPrice ?? 0,
            materialId: m.id,
            sortOrder: comps.length,
          }),
        }
      );
      setMatQuery("");
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  // Subir esta línea al catálogo de la partida ("solo lo que toqué").
  async function pushToCatalog(compId: string) {
    setSaving(compId);
    try {
      const r = await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes/${compId}/al-catalogo`,
        { method: "POST" }
      );
      if (r.ok) {
        setPushedId(compId);
        setTimeout(() => setPushedId((id) => (id === compId ? null : id)), 2500);
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || "No se pudo subir al catálogo");
      }
    } finally {
      setSaving(null);
    }
  }

  async function addComp(type: string) {
    setSaving("__new");
    try {
      await fetch(
        `/api/presupuestos/${budgetId}/partidas/${itemId}/componentes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            description: "",
            unit: type === "margen" || type === "perdida" ? "%" : "UN",
            quantity: type === "margen" ? 10 : type === "perdida" ? 5 : 0,
            unitCost: 0,
            sortOrder: comps.length,
            appliedToType: type === "mano_obra" ? null : null,
          }),
        }
      );
      await fetchComps();
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <div className="text-xs text-gray-500">Cargando componentes…</div>;
  }

  if (comps.length === 0 && !canEdit) {
    return (
      <div className="text-xs text-gray-400 italic">
        Este ítem no tiene componentes desglosados.
      </div>
    );
  }

  return (
    <div
      className={
        dense
          ? "space-y-0.5 text-[10px] leading-none [&_td]:!py-0 [&_th]:!py-[1px] " +
            "[&_input]:!text-[10px] [&_input]:!leading-none [&_select]:!text-[10px] [&_td]:!align-middle " +
            // Chips de tipo (Material/Mano de obra/…) sin alto extra: aprietan
            // el renglón. Son los únicos <span> con .rounded en la tabla.
            "[&_span.rounded]:!py-0 [&_span.rounded]:!leading-none"
          : "space-y-2"
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Detalle de materiales y costos
        </span>
        {!canEdit && (
          <span className="text-[10px] italic text-gray-400">
            Solo lectura — el presupuesto no está en borrador.
          </span>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 uppercase tracking-wider text-[10px] border-b border-gray-200">
            <th className="text-left py-1 px-2 font-medium w-28">Tipo</th>
            <th className="text-left py-1 px-2 font-medium">Descripción</th>
            <th className="text-center py-1 px-2 font-medium w-16">Un.</th>
            <th className="text-right py-1 px-2 font-medium w-16">Cant./%</th>
            <th className="text-right py-1 px-2 font-medium w-24">Costo</th>
            <th className="text-right py-1 px-2 font-medium w-24">Total</th>
            <th className="w-20"></th>
          </tr>
        </thead>
        <tbody>
          {orderForDisplay(comps).map((c) => {
            const meta = typeMeta(c.type);
            const isPct = c.unit === "%";
            // Pérdida calculada sobre un material concreto: se muestra anidada
            // debajo de ese material, con sangría y "↳" para que se lea como
            // dependiente de la línea de arriba.
            const isNestedPerdida = c.type === "perdida" && !!c.appliedToComponentId;
            return (
              <tr
                key={c.id}
                className={`border-b last:border-0 ${
                  dense ? "border-gray-100" : "border-gray-50"
                }`}
              >
                <td className={`py-1 px-2 ${isNestedPerdida ? "pl-6" : ""}`}>
                  {isNestedPerdida && (
                    <span className="text-gray-300 mr-1" aria-hidden="true">
                      ↳
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${meta.color}`}>
                    {meta.label}
                  </span>
                  {c.isCustomized && (
                    <span
                      className="ml-1 text-[9px] uppercase text-amber-600"
                      title="Editado a mano — el sync masivo no lo toca."
                    >
                      mod
                    </span>
                  )}
                </td>
                <td className="py-1 px-2">
                  {/* Input + link ↗ en la MISMA línea (flex), si no el ↗
                      caía en un renglón nuevo e inflaba las filas con
                      referencia (vista densa). */}
                  <div className="flex items-center gap-1">
                  {canEdit ? (
                    <input
                      type="text"
                      defaultValue={c.description}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v !== c.description) patchComp(c.id, "description", v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="flex-1 min-w-0 bg-transparent text-gray-900"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 text-gray-900">{c.description}</span>
                  )}
                  {c.referenceLink && (
                    <a
                      href={c.referenceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-blue-500"
                      title={c.referenceLink}
                    >
                      ↗
                    </a>
                  )}
                  </div>
                </td>
                <td className="py-1 px-2 text-center text-gray-500">
                  {canEdit ? (
                    <select
                      value={c.unit}
                      onChange={(e) => changeUnit(c, e.target.value)}
                      className="bg-transparent text-gray-700 text-xs text-center cursor-pointer"
                      title="Unidad. Elegí % para que la línea sea un porcentaje (leyes sociales sobre la mano de obra, margen sobre el costo)."
                    >
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : (
                    c.unit
                  )}
                </td>
                <td className="py-1 px-2 text-right">
                  {canEdit ? (
                    <div className="flex items-center justify-end gap-0.5">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={c.quantity}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (v !== c.quantity) patchComp(c.id, "quantity", v);
                        }}
                        className="w-full bg-transparent text-right text-gray-900 tabular-nums"
                      />
                      {isPct && <span className="text-gray-400 text-[10px]">%</span>}
                    </div>
                  ) : (
                    <span className="text-gray-700 tabular-nums">
                      {c.quantity}
                      {isPct ? "%" : ""}
                    </span>
                  )}
                </td>
                <td className="py-1 px-2 text-right">
                  {isPct && c.type === "perdida" && canEdit ? (
                    // Pérdida = % de un material concreto: hay que elegir cuál.
                    <select
                      value={c.appliedToComponentId ?? ""}
                      onChange={(e) =>
                        patchComp(c.id, "appliedToComponentId", e.target.value || null)
                      }
                      className="w-full bg-white border border-gray-200 rounded text-[10px] px-1 py-0.5"
                      title="Sobre cuál material se aplica la pérdida"
                    >
                      <option value="">— sobre cuál material —</option>
                      {comps
                        .filter((m) => m.type === "material" && m.id !== c.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.description.slice(0, 28) || "(sin descripción)"}
                          </option>
                        ))}
                    </select>
                  ) : isPct ? (
                    <span className="text-[10px] text-gray-400 italic">
                      {c.type === "margen"
                        ? "sobre resto"
                        : c.type === "perdida"
                          ? "sobre material"
                          : c.type === "mano_obra"
                            ? "sobre M.O."
                            : "—"}
                    </span>
                  ) : canEdit ? (
                    <MoneyInput
                      value={c.unitCost}
                      onChange={(v) => patchComp(c.id, "unitCost", v)}
                      className="w-full bg-transparent text-right tabular-nums text-gray-900"
                    />
                  ) : (
                    <span className="text-gray-700 tabular-nums">
                      {formatCLP(c.unitCost)}
                    </span>
                  )}
                </td>
                <td className={`py-1 px-2 text-right font-medium text-gray-900 tabular-nums ${dense ? "text-[9px]" : ""}`}>
                  {formatCLP(c.totalCost)}
                </td>
                <td className="py-1 px-1 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      {catalogPartidaId &&
                        (pushedId === c.id ? (
                          <span className="text-[10px] text-emerald-600 mr-1.5">
                            ✓ en catálogo
                          </span>
                        ) : (
                          <button
                            onClick={() => pushToCatalog(c.id)}
                            disabled={saving === c.id}
                            className="text-gray-300 hover:text-gray-900 text-sm leading-none mr-1.5 disabled:opacity-40"
                            title="Subir solo esta línea al catálogo de la partida (queda guardada para la próxima vez)"
                          >
                            ↑
                          </button>
                        ))}
                      <button
                        onClick={() => deleteComp(c.id)}
                        disabled={saving === c.id}
                        className="text-gray-300 hover:text-red-600 text-sm leading-none"
                        title="Eliminar línea"
                      >
                        ×
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit && (
        <div className={dense ? "space-y-1 pt-0.5" : "space-y-2 pt-1"}>
          {/* Agregar material buscándolo en el catálogo (trae su precio) o
              creando uno nuevo si no existe. */}
          <div className="flex items-center gap-2">
            <span className={`${dense ? "text-[8px]" : "text-[10px]"} uppercase tracking-wider text-gray-500 w-28 shrink-0`}>
              Agregar material
            </span>
            <div className="flex-1 max-w-md">
              <MaterialAutocomplete
                value={matQuery}
                onChange={setMatQuery}
                onSelect={(m) => addMaterial(m)}
                placeholder="Buscar material en el catálogo… (ej: cerámica, pegamento)"
              />
            </div>
          </div>

          {/* Otros tipos de línea (mano de obra, herramientas, etc.). */}
          <div className="flex flex-wrap gap-1">
            {COMP_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => addComp(t.value)}
                disabled={saving === "__new"}
                className={`${dense ? "text-[8px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"} uppercase tracking-wider rounded border border-gray-200 hover:border-gray-400 ${t.color} disabled:opacity-50`}
              >
                + {t.label}
              </button>
            ))}
            {/* Leyes sociales = mano de obra como % sobre la mano de obra. */}
            <button
              type="button"
              onClick={addLeyes}
              disabled={saving === "__new"}
              className={`${dense ? "text-[8px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"} uppercase tracking-wider rounded border border-gray-200 hover:border-gray-400 bg-emerald-50 text-emerald-700 disabled:opacity-50`}
              title="Agrega leyes sociales como % sobre la mano de obra"
            >
              + Leyes sociales %
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
