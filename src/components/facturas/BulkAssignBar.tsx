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
  appliesTo?: string; // "recibida" | "emitida" | "both"
  parent: { id: string; name: string } | null;
};

function projectLabel(p: Project) {
  const n = p.numeroProyecto ?? p.numeroCotizacion;
  return n != null ? `${n} · ${p.name}` : p.name;
}

type LearnedRule = {
  ruleId: string;
  created: boolean;
  previousCategoryId: string | null;
  previousProjectId: string | null;
};

// Action bar fixed-bottom que aparece cuando hay facturas seleccionadas
// en /facturas. Dropdowns para asignar categoría + proyecto en bulk.
// Si MJ prende "Guardar categoría en regla" (o el de centro de costo), el
// endpoint crea/cambia la regla del proveedor y se muestra un toast con
// "Deshacer". Sin tilde no se toca ninguna regla (pendiente 184).
export default function BulkAssignBar({
  selectedIds,
  selectedTypes,
  onClear,
  projects,
  categories,
}: {
  selectedIds: string[];
  // Tipos de factura seleccionadas (set para evitar duplicados). Si son
  // todas del mismo tipo filtramos las categorías al subset que aplica.
  // Si hay tipos mezclados (raro pero posible), mostramos todas con
  // grupos separados.
  selectedTypes: Set<"emitida" | "recibida">;
  onClear: () => void;
  projects: Project[];
  categories: Category[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  // Dos reglas independientes, las DOS parten apagadas: la regla del
  // proveedor se guarda solo cuando MJ prende el tilde (pendiente 184). La
  // de categoría partía prendida y pisaba reglas sin que ella lo decidiera.
  //   - Proyecto: La mayoría de los proveedores son
  //     transversales a varias obras (Easy/Sodimac/MK). Solo prender
  //     cuando el proveedor identifica unívocamente al proyecto
  //     (Autopistas/Bencina/Patente → BLARQ siempre).
  const [learnCategoryRule, setLearnCategoryRule] = useState(false);
  const [learnProjectRule, setLearnProjectRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    // Reglas creadas o cambiadas en esta asignación, con lo que tenían antes,
    // para que "Deshacer" las deje como estaban (no borrarlas enteras).
    learned: LearnedRule[];
  } | null>(null);

  // Filtrar categorías según el tipo de las facturas seleccionadas.
  // Si todas son del mismo tipo: mostramos las que appliesTo a ese tipo
  // (+ las "both"). Si hay tipos mezclados: mostramos todas.
  const onlyType =
    selectedTypes.size === 1 ? Array.from(selectedTypes)[0] : null;
  const visibleCategories = onlyType
    ? categories.filter(
        (c) => !c.appliesTo || c.appliesTo === onlyType || c.appliesTo === "both"
      )
    : categories;

  // Categorías agrupadas por padre (igual al filter bar)
  const grouped: Record<string, Category[]> = {};
  for (const c of visibleCategories) {
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
      // Toggles separados — el endpoint aprende solo si vienen en true.
      if (learnCategoryRule) body.learnCategoryRule = true;
      if (learnProjectRule) body.learnProjectRule = true;

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
        previousCategoryId: string | null;
        previousProjectId: string | null;
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

      const learned = newRules.filter((r) => r.created || r.updated);

      setToast({
        message: `✓ ${data.updated} factura${data.updated !== 1 ? "s" : ""} asignada${data.updated !== 1 ? "s" : ""}${ruleParts.length ? " · " + ruleParts.join(" + ") : ""}`,
        learned,
      });
      // Limpiar selección y refrescar lista
      setProjectId("");
      setCategoryId("");
      // Los tildes vuelven a apagarse: guardar regla es una decisión por
      // asignación, no algo que quede prendido para la siguiente.
      setLearnCategoryRule(false);
      setLearnProjectRule(false);
      onClear();
      router.refresh();
      // Auto-ocultar toast a los 12s (más largo de lo normal porque tiene "Deshacer")
      setTimeout(() => setToast(null), 12000);
    } finally {
      setBusy(false);
    }
  }

  async function undoLearnedRules() {
    if (!toast || toast.learned.length === 0) return;
    if (
      !confirm(
        `¿Deshacer las ${toast.learned.length} regla${toast.learned.length !== 1 ? "s" : ""} creadas/cambiadas?\n\n(Las facturas que ya quedaron asignadas no se desasignan — las reglas nuevas se borran y las cambiadas vuelven a lo que tenían.)`
      )
    )
      return;
    await Promise.all(
      toast.learned.map((r) =>
        // Regla nueva → se borra. Regla que ya existía → vuelve a lo que
        // tenía. Antes se borraban todas, y deshacer un cambio a la regla de
        // Easy dejaba a Easy sin regla.
        r.created
          ? fetch(`/api/facturas/reglas/${r.ruleId}`, { method: "DELETE" })
          : fetch(`/api/facturas/reglas/${r.ruleId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                categoryId: r.previousCategoryId,
                projectId: r.previousProjectId,
              }),
            })
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

          {/* Dos toggles independientes — solo aparecen si el campo
              correspondiente fue elegido (y no es "sin asignar"). */}
          {categoryId && categoryId !== "__none__" && (
            <label
              className="text-xs flex items-center gap-1 text-gray-300 hover:text-white cursor-pointer select-none"
              title="Prendelo solo si este proveedor va SIEMPRE a esta categoría: las próximas facturas suyas entrarán así. Apagado, la regla del proveedor no se toca."
            >
              <input
                type="checkbox"
                checked={learnCategoryRule}
                onChange={(e) => setLearnCategoryRule(e.target.checked)}
                disabled={busy}
                className="accent-emerald-600"
              />
              Guardar categoría en regla
            </label>
          )}
          {projectId && projectId !== "__none__" && (
            <label
              className="text-xs flex items-center gap-1 text-gray-300 hover:text-white cursor-pointer select-none"
              title="Solo prendelo cuando el proveedor SIEMPRE va al mismo centro de costo (Autopistas/Bencina/Patente → BLARQ). Para proveedores transversales como Easy, Sodimac o MK, dejalo apagado: las facturas se asignan a esta obra pero no se contagia a futuras."
            >
              <input
                type="checkbox"
                checked={learnProjectRule}
                onChange={(e) => setLearnProjectRule(e.target.checked)}
                disabled={busy}
                className="accent-emerald-600"
              />
              Guardar centro de costo en regla
            </label>
          )}
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
          {toast.learned.length > 0 && (
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
