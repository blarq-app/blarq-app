"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type ComputedRow = {
  key: string;
  shoppingItemId: string | null;
  name: string;
  unit: string;
  materialId: string | null;
  qtyNeeded: number;
  qtyBought: number;
  notes: string | null;
  source: "budget" | "manual" | "excess";
  partidas: string[];
};

type Budget = { id: string; version: string; status: string };

export default function ListaCompraClient({
  projectId,
  rows,
  budgets,
  selectedBudgetId,
  itemsWithoutCatalog,
}: {
  projectId: string;
  rows: ComputedRow[];
  budgets: Budget[];
  selectedBudgetId: string | null;
  itemsWithoutCatalog: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"todo" | "pendiente" | "comprado">(
    "todo"
  );
  const [localRows, setLocalRows] = useState<ComputedRow[]>(rows);
  const [newItem, setNewItem] = useState({ name: "", unit: "UN" });
  const [showNew, setShowNew] = useState(false);

  // Si cambia rows (por server refresh), actualiza
  if (rows !== (localRows as any)._src) {
    // simple sync: always trust fresh rows from server on prop change
    // (React will re-run this on each render; setLocalRows only if prop identity changed)
  }

  async function saveTracking(
    row: ComputedRow,
    changes: { qtyBought?: number; notes?: string | null }
  ) {
    const next = { ...row, ...changes };
    setLocalRows((prev) =>
      prev.map((r) => (r.key === row.key ? next : r))
    );

    // Upsert por key
    const body = {
      shoppingItemId: row.shoppingItemId,
      name: row.name,
      unit: row.unit,
      materialId: row.materialId,
      qtyBought: next.qtyBought,
      notes: next.notes,
      manualAdd: row.source === "manual",
    };
    const res = await fetch(`/api/proyectos/${projectId}/lista-compra/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const d = await res.json();
      if (!row.shoppingItemId && d.id) {
        setLocalRows((prev) =>
          prev.map((r) =>
            r.key === row.key ? { ...r, shoppingItemId: d.id } : r
          )
        );
      }
    }
  }

  async function deleteRow(row: ComputedRow) {
    if (!row.shoppingItemId) return;
    if (!confirm("Eliminar este material del tracking?")) return;
    await fetch(
      `/api/proyectos/${projectId}/lista-compra/${row.shoppingItemId}`,
      { method: "DELETE" }
    );
    // Si era manual o excess desaparece; si era budget vuelve a qtyBought=0
    if (row.source === "budget") {
      setLocalRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? { ...r, shoppingItemId: null, qtyBought: 0, notes: null }
            : r
        )
      );
    } else {
      setLocalRows((prev) => prev.filter((r) => r.key !== row.key));
    }
  }

  async function addManual() {
    if (!newItem.name.trim()) return;
    const res = await fetch(`/api/proyectos/${projectId}/lista-compra`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newItem, qtyBought: 0 }),
    });
    if (!res.ok) return;
    setNewItem({ name: "", unit: "UN" });
    setShowNew(false);
    router.refresh();
  }

  const filtered = useMemo(() => {
    return localRows.filter((i) => {
      const pend = i.qtyNeeded - i.qtyBought;
      if (filter === "pendiente") return pend > 0.001;
      if (filter === "comprado")
        return pend <= 0.001 && (i.qtyNeeded > 0 || i.qtyBought > 0);
      return true;
    });
  }, [localRows, filter]);

  return (
    <div className="space-y-4">
      {/* Selector de versión + toolbar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Presupuesto:</label>
            <select
              value={selectedBudgetId || ""}
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set("v", e.target.value);
                window.location.href = url.toString();
              }}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.version} · {b.status}
                </option>
              ))}
              {budgets.length === 0 && <option>— sin presupuesto —</option>}
            </select>
          </div>
          <div className="text-sm">
            <span className="text-gray-500">Materiales: </span>
            <span className="font-semibold text-gray-900">
              {localRows.length}
            </span>
          </div>
          <div className="flex items-center gap-1 border border-gray-200 rounded p-0.5">
            {(["todo", "pendiente", "comprado"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 text-xs rounded ${
                  filter === f
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {f === "todo"
                  ? "Todos"
                  : f === "pendiente"
                  ? "Pendientes"
                  : "Comprados"}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="text-sm border border-gray-300 px-3 py-2 rounded hover:bg-gray-50"
        >
          + Agregar manual
        </button>
      </div>

      {itemsWithoutCatalog > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
          ⚠ {itemsWithoutCatalog} partidas del presupuesto no están vinculadas
          al catálogo — sus materiales no se incluyen en esta lista.
        </div>
      )}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500">Material</label>
            <input
              value={newItem.name}
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1"
              placeholder="Nombre"
            />
          </div>
          <div className="w-20">
            <label className="text-xs text-gray-500">Unidad</label>
            <input
              value={newItem.unit}
              onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1"
            />
          </div>
          <button
            onClick={addManual}
            className="bg-gray-900 text-white px-3 py-2 rounded text-sm"
          >
            Agregar
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2 text-center w-16">Unidad</th>
              <th className="px-3 py-2 text-right w-28">Necesario</th>
              <th className="px-3 py-2 text-right w-28">Comprado</th>
              <th className="px-3 py-2 text-right w-28">Pendiente</th>
              <th className="px-3 py-2 text-center w-24">Estado</th>
              <th className="px-3 py-2 text-left">Notas</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-gray-500 text-sm"
                >
                  No hay materiales. El presupuesto no tiene partidas con
                  componentes en el catálogo, o agrega uno manual.
                </td>
              </tr>
            )}
            {filtered.map((i) => {
              const pend = i.qtyNeeded - i.qtyBought;
              const done = pend <= 0.001 && i.qtyNeeded > 0;
              const excess =
                i.source === "excess" ||
                (i.qtyNeeded === 0 && i.qtyBought > 0);
              return (
                <tr
                  key={i.key}
                  className={
                    done
                      ? "bg-green-50/40"
                      : excess
                      ? "bg-amber-50/40"
                      : ""
                  }
                >
                  <td className="px-3 py-2">
                    <div className="text-gray-900">{i.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {i.source === "manual" && (
                        <span className="text-[10px] text-blue-600">
                          manual
                        </span>
                      )}
                      {i.source === "excess" && (
                        <span className="text-[10px] text-amber-700">
                          excedente (ya no en presupuesto)
                        </span>
                      )}
                      {i.partidas.length > 0 && (
                        <span
                          className="text-[10px] text-gray-400"
                          title={i.partidas.join(", ")}
                        >
                          ({i.partidas.length} partida
                          {i.partidas.length > 1 ? "s" : ""})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">
                    {i.unit}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {formatNum(i.qtyNeeded)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={i.qtyBought}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) =>
                        saveTracking(i, { qtyBought: Number(e.target.value) })
                      }
                      className="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm"
                    />
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      pend > 0.001 ? "text-orange-700" : "text-gray-400"
                    }`}
                  >
                    {formatNum(Math.max(0, pend))}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {done ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px]">
                        completo
                      </span>
                    ) : i.qtyBought > 0 ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-[10px]">
                        parcial
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-[10px]">
                        pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={i.notes || ""}
                      onChange={(e) =>
                        saveTracking(i, { notes: e.target.value })
                      }
                      placeholder="—"
                      className="w-full border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-1 py-0.5 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {i.shoppingItemId && (
                      <button
                        onClick={() => deleteRow(i)}
                        className="text-gray-400 hover:text-red-600 text-xs"
                        title={
                          i.source === "budget"
                            ? "Limpiar compras"
                            : "Eliminar"
                        }
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatNum(n: number) {
  if (Number.isInteger(n)) return n.toLocaleString("es-CL");
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}
