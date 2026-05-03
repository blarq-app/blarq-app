"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Rule = {
  id: string;
  rutIssuer: string;
  businessName: string | null;
  categoryId: string;
  categoryLabel: string;
  hits: number;
  createdAt: string;
};

type Category = {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
};

export default function InvoiceRulesTable({
  rules,
  categories,
}: {
  rules: Rule[];
  categories: Category[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string>("");
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
    if (busy || !editingCategoryId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/facturas/reglas/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: editingCategoryId }),
      });
      if (!res.ok) {
        alert("Error al actualizar regla");
        return;
      }
      setEditingId(null);
      setEditingCategoryId("");
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
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
          <tr>
            <th className="text-left px-4 py-2">Proveedor</th>
            <th className="text-left px-4 py-2 w-32 tabular-nums">RUT</th>
            <th className="text-left px-4 py-2">Categoría</th>
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
                  {r.rutIssuer}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {isEditing ? (
                    <select
                      value={editingCategoryId}
                      onChange={(e) => setEditingCategoryId(e.target.value)}
                      autoFocus
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                    >
                      <option value="">— Elegir —</option>
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
                    r.categoryLabel
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
                        disabled={busy || !editingCategoryId}
                        className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800 disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingCategoryId("");
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
                          setEditingCategoryId(r.categoryId);
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
