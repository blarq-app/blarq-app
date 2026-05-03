"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Project = {
  id: string;
  name: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
};
type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

function projectLabel(p: Project) {
  const n = p.numeroProyecto ?? p.numeroCotizacion;
  return n != null ? `${n} · ${p.name}` : p.name;
}

// Action bar fixed-bottom que aparece cuando hay facturas seleccionadas
// en /facturas. Dropdowns para asignar categoría + proyecto en bulk.
// Si se asigna categoría, se crean reglas por RUT en paralelo (en el
// endpoint), y se muestra un toast con "Deshacer" todas las reglas creadas.
export default function BulkAssignBar({
  selectedIds,
  onClear,
  projects,
  categories,
}: {
  selectedIds: string[];
  onClear: () => void;
  projects: Project[];
  categories: Category[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    learnedRuleIds: string[];
  } | null>(null);

  // Categorías agrupadas por padre (igual al filter bar)
  const grouped: Record<string, Category[]> = {};
  for (const c of categories) {
    const parentName = c.parent?.name ?? c.name;
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(c);
  }
  const parentNames = Object.keys(grouped).sort();

  if (selectedIds.length === 0 && !toast) return null;

  async function apply() {
    if (busy) return;
    if (!projectId && !categoryId) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { invoiceIds: selectedIds };
      if (projectId === "__none__") body.projectId = null;
      else if (projectId) body.projectId = projectId;
      if (categoryId === "__none__") body.categoryId = null;
      else if (categoryId) body.categoryId = categoryId;

      const res = await fetch("/api/facturas/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Error al asignar");
        return;
      }

      const ruleParts: string[] = [];
      const newRules = (data.learnedRules ?? []) as Array<{
        ruleId: string;
        created: boolean;
        updated: boolean;
        businessName: string | null;
      }>;
      const created = newRules.filter((r) => r.created);
      const updated = newRules.filter((r) => r.updated);
      if (created.length > 0) {
        ruleParts.push(
          `${created.length} regla${created.length !== 1 ? "s" : ""} nueva${created.length !== 1 ? "s" : ""}`
        );
      }
      if (updated.length > 0) {
        ruleParts.push(
          `${updated.length} regla${updated.length !== 1 ? "s" : ""} cambiada${updated.length !== 1 ? "s" : ""}`
        );
      }

      const learnedRuleIds = newRules
        .filter((r) => r.created || r.updated)
        .map((r) => r.ruleId);

      setToast({
        message: `✓ ${data.updated} factura${data.updated !== 1 ? "s" : ""} asignada${data.updated !== 1 ? "s" : ""}${ruleParts.length ? " · " + ruleParts.join(" + ") : ""}`,
        learnedRuleIds,
      });
      // Limpiar selección y refrescar lista
      setProjectId("");
      setCategoryId("");
      onClear();
      router.refresh();
      // Auto-ocultar toast a los 12s (más largo de lo normal porque tiene "Deshacer")
      setTimeout(() => setToast(null), 12000);
    } finally {
      setBusy(false);
    }
  }

  async function undoLearnedRules() {
    if (!toast || toast.learnedRuleIds.length === 0) return;
    if (
      !confirm(
        `¿Deshacer las ${toast.learnedRuleIds.length} regla${toast.learnedRuleIds.length !== 1 ? "s" : ""} creadas/cambiadas?\n\n(Las facturas que ya quedaron asignadas no se desasignan — solo se borran las reglas para futuras facturas.)`
      )
    )
      return;
    await Promise.all(
      toast.learnedRuleIds.map((id) =>
        fetch(`/api/facturas/reglas/${id}`, { method: "DELETE" })
      )
    );
    setToast(null);
    router.refresh();
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]">
      {/* Action bar — solo si hay selección */}
      {selectedIds.length > 0 && !toast && (
        <div className="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium tabular-nums">
            {selectedIds.length} seleccionada{selectedIds.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-gray-400">·</span>

          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="text-xs bg-white text-gray-900 border border-gray-300 rounded px-2 py-1 max-w-[200px]"
            disabled={busy}
          >
            <option value="">Categoría —</option>
            <option value="__none__">— Sin categoría —</option>
            {parentNames.map((parent) => (
              <optgroup key={parent} label={parent}>
                {grouped[parent].map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? c.name : `${c.name} (top)`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="text-xs bg-white text-gray-900 border border-gray-300 rounded px-2 py-1 max-w-[200px]"
            disabled={busy}
          >
            <option value="">Centro de costo —</option>
            <option value="__none__">— Sin asignar —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {projectLabel(p)}
              </option>
            ))}
          </select>

          <button
            disabled={busy || (!projectId && !categoryId)}
            onClick={apply}
            className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Aplicando…" : "Aplicar"}
          </button>
          <button
            onClick={onClear}
            disabled={busy}
            className="text-xs text-gray-300 hover:text-white px-2"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Toast post-aplicación con Deshacer reglas */}
      {toast && (
        <div className="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm">{toast.message}</span>
          {toast.learnedRuleIds.length > 0 && (
            <button
              onClick={undoLearnedRules}
              className="text-xs underline text-amber-300 hover:text-amber-200"
            >
              Deshacer reglas
            </button>
          )}
          <button
            onClick={() => setToast(null)}
            className="text-xs text-gray-400 hover:text-white px-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
