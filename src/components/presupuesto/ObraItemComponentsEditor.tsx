"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";
import MoneyInput from "@/components/ui/MoneyInput";

interface Material {
  id: string;
  name: string;
  unit: string;
  netPrice: number;
  referenceLink: string | null;
}

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

export default function ObraItemComponentsEditor({
  budgetId,
  itemId,
  canEdit,
  onChanged,
}: {
  budgetId: string;
  itemId: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const [comps, setComps] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

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
      }
    } finally {
      setLoading(false);
    }
  }, [budgetId, itemId]);

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
            quantity: type === "margen" ? 10 : 0,
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Desglose por componente
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
            <th className="text-right py-1 px-2 font-medium w-16">Cant.</th>
            <th className="text-right py-1 px-2 font-medium w-24">Costo</th>
            <th className="text-right py-1 px-2 font-medium w-24">Total</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => {
            const meta = typeMeta(c.type);
            const isPct = c.unit === "%";
            return (
              <tr key={c.id} className="border-b border-gray-50 last:border-0">
                <td className="py-1 px-2">
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
                      className="w-full bg-transparent text-gray-900"
                    />
                  ) : (
                    <span className="text-gray-900">{c.description}</span>
                  )}
                  {c.referenceLink && (
                    <a
                      href={c.referenceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-blue-500"
                      title={c.referenceLink}
                    >
                      ↗
                    </a>
                  )}
                </td>
                <td className="py-1 px-2 text-center text-gray-500">{c.unit}</td>
                <td className="py-1 px-2 text-right">
                  {canEdit ? (
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
                  ) : (
                    <span className="text-gray-700 tabular-nums">{c.quantity}</span>
                  )}
                </td>
                <td className="py-1 px-2 text-right">
                  {isPct ? (
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
                <td className="py-1 px-2 text-right font-medium text-gray-900 tabular-nums">
                  {formatCLP(c.totalCost)}
                </td>
                <td className="py-1 px-1 text-right">
                  {canEdit && (
                    <button
                      onClick={() => deleteComp(c.id)}
                      disabled={saving === c.id}
                      className="text-gray-300 hover:text-red-600 text-sm leading-none"
                      title="Eliminar componente"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit && (
        <div className="flex flex-wrap gap-1 pt-1">
          {COMP_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => addComp(t.value)}
              disabled={saving === "__new"}
              className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-gray-200 hover:border-gray-400 ${t.color} disabled:opacity-50`}
            >
              + {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
