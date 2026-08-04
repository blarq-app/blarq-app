"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Rule = {
  id: string;
  rutIssuer: string | null;
  businessName: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  projectId: string | null;
  projectLabel: string | null;
  hits: number;
  createdAt: string;
};

type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

type Project = {
  id: string;
  name: string;
};

export default function InvoiceRulesTable({
  rules,
  categories,
  projects,
}: {
  rules: Rule[];
  categories: Category[];
  projects: Project[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string>("");
  const [editingProjectId, setEditingProjectId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Categorías agrupadas por padre
  const grouped: Record<string, Category[]> = {};
  for (const c of categories) {
    const parentName = c.parent?.name ?? c.name;
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(c);
  }
  const parentNames = Object.keys(grouped).sort();

  async function saveEdit(ruleId: string) {
    if (busy) return;
    // Necesita al menos uno de los dos campos puestos.
    if (!editingCategoryId && !editingProjectId) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      // Permitimos vaciar enviando "" → null para borrar uno de los dos.
      body.categoryId = editingCategoryId || null;
      body.projectId = editingProjectId || null;
      const res = await fetch(`/api/facturas/reglas/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        alert("Error al actualizar regla");
        return;
      }
      setEditingId(null);
      setEditingCategoryId("");
      setEditingProjectId("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(ruleId: string, businessName: string | null) {
    if (busy) return;
    if (
      !confirm(
        `¿Eliminar regla para ${businessName ?? "este proveedor"}?\n\nLas facturas ya categorizadas no se modifican. Solo deja de aplicarse a las nuevas.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/facturas/reglas/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Error al eliminar");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (rules.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
        <p className="text-sm">Aún no hay reglas guardadas.</p>
        <p className="text-xs text-gray-400 mt-1">
          Las reglas se crean solas cuando asignás categoría a una factura recibida.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* ── Celular: una tarjeta por regla ────────────────────────────────
          La tabla tiene 7 columnas y ~830px de ancho: en el teléfono se veía
          Proveedor y RUT, y quedaban fuera justo Categoría y Centro de costo,
          que es lo que la regla decide. */}
      <div className="lg:hidden divide-y divide-gray-100">
        {rules.map((r) => {
          const isEditing = editingId === r.id;
          return (
            <div key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 leading-snug">
                    {r.businessName ?? (
                      <span className="text-gray-400 italic">sin nombre</span>
                    )}
                  </p>
                  <p className="text-[11px] tabular-nums text-gray-500 mt-0.5">
                    {r.rutIssuer ?? (
                      <span className="italic tracking-normal">internacional</span>
                    )}
                    {" · "}
                    aplicada {r.hits}×
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400 tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString("es-CL", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}
                </span>
              </div>

              <dl className="mt-2 space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <dt className="w-28 shrink-0 text-gray-400">Categoría</dt>
                  <dd className="min-w-0 flex-1 text-gray-700">
                    {isEditing ? (
                      <select
                        value={editingCategoryId}
                        onChange={(e) => setEditingCategoryId(e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">— sin categoría —</option>
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
                    ) : (
                      r.categoryLabel ?? <span className="text-gray-400 italic">—</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="w-28 shrink-0 text-gray-400">Centro de costo</dt>
                  <dd className="min-w-0 flex-1 text-gray-700">
                    {isEditing ? (
                      <select
                        value={editingProjectId}
                        onChange={(e) => setEditingProjectId(e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">— sin proyecto —</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      r.projectLabel ?? <span className="text-gray-400 italic">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="flex items-center gap-2 mt-3">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => saveEdit(r.id)}
                      disabled={busy || (!editingCategoryId && !editingProjectId)}
                      className="min-h-10 px-4 text-xs bg-gray-900 text-white rounded disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditingCategoryId("");
                        setEditingProjectId("");
                      }}
                      className="min-h-10 px-3 text-xs text-gray-500"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(r.id);
                        setEditingCategoryId(r.categoryId ?? "");
                        setEditingProjectId(r.projectId ?? "");
                      }}
                      className="min-h-10 px-4 text-xs border border-gray-300 rounded text-gray-700"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => deleteRule(r.id, r.businessName)}
                      disabled={busy}
                      className="ml-auto min-h-10 px-3 text-xs text-gray-400 hover:text-rose-600 disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Escritorio: la tabla densa de siempre, sin cambios ───────────── */}
      <table className="hidden lg:table w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
          <tr>
            <th className="text-left px-4 py-2">Proveedor</th>
            <th className="text-left px-4 py-2 w-32 tabular-nums">RUT</th>
            <th className="text-left px-4 py-2">Categoría</th>
            <th className="text-left px-4 py-2">Centro de costo</th>
            <th className="text-right px-4 py-2 w-24">Aplicada</th>
            <th className="text-left px-4 py-2 w-32">Creada</th>
            <th className="px-4 py-2 w-28"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rules.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-900 truncate max-w-[260px]">
                  {r.businessName ?? <span className="text-gray-400 italic">sin nombre</span>}
                </td>
                <td className="px-4 py-2 tabular-nums text-xs text-gray-600">
                  {r.rutIssuer ?? (
                    <span className="text-gray-400 italic tracking-normal">internacional</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {isEditing ? (
                    <select
                      value={editingCategoryId}
                      onChange={(e) => setEditingCategoryId(e.target.value)}
                      autoFocus
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                    >
                      <option value="">— sin categoría —</option>
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
                  ) : (
                    r.categoryLabel ?? <span className="text-gray-400 italic">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {isEditing ? (
                    <select
                      value={editingProjectId}
                      onChange={(e) => setEditingProjectId(e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                    >
                      <option value="">— sin proyecto —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  ) : (
                    r.projectLabel ?? <span className="text-gray-400 italic">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {r.hits}× {r.hits === 0 && <span className="text-gray-300">·</span>}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500 tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString("es-CL", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}
                </td>
                <td className="px-4 py-2 text-right">
                  {isEditing ? (
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => saveEdit(r.id)}
                        disabled={busy || (!editingCategoryId && !editingProjectId)}
                        className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800 disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingCategoryId("");
                          setEditingProjectId("");
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => {
                          setEditingId(r.id);
                          setEditingCategoryId(r.categoryId ?? "");
                          setEditingProjectId(r.projectId ?? "");
                        }}
                        className="text-xs text-gray-500 hover:text-gray-900 underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => deleteRule(r.id, r.businessName)}
                        disabled={busy}
                        className="text-xs text-gray-400 hover:text-rose-600 disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
