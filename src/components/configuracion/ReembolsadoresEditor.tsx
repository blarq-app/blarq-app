"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Alias = {
  id?: string;
  rut: string;
  businessName: string | null;
};

type Reembolsador = {
  id: string;
  nombre: string;
  glosa: string;
  // Legacy single (todavia viene poblado para back-compat).
  rutAlias?: string | null;
  businessName?: string | null;
  aliases?: Alias[];
};

export default function ReembolsadoresEditor({
  initial,
}: {
  initial: Reembolsador[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);

  // Form de creacion
  const [nombre, setNombre] = useState("");
  const [glosa, setGlosa] = useState("");
  const [newAliases, setNewAliases] = useState<Alias[]>([
    { rut: "", businessName: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado de edicion inline (id del item siendo editado)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editGlosa, setEditGlosa] = useState("");
  const [editAliases, setEditAliases] = useState<Alias[]>([]);

  function startEdit(r: Reembolsador) {
    setEditingId(r.id);
    setEditNombre(r.nombre);
    setEditGlosa(r.glosa);
    // Si tiene aliases listados, usamos esos. Sino, intentamos backfill
    // desde el rutAlias legacy (un solo alias).
    const aliasesArr = r.aliases && r.aliases.length > 0
      ? r.aliases.map((a) => ({ id: a.id, rut: a.rut, businessName: a.businessName ?? "" }))
      : r.rutAlias
        ? [{ rut: r.rutAlias, businessName: r.businessName ?? "" }]
        : [];
    setEditAliases(aliasesArr.length > 0 ? aliasesArr : [{ rut: "", businessName: "" }]);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditNombre("");
    setEditGlosa("");
    setEditAliases([]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim() || !glosa.trim()) {
      setError("Nombre y glosa son obligatorios");
      return;
    }
    const cleanAliases = newAliases
      .map((a) => ({ rut: a.rut.trim(), businessName: a.businessName?.trim() || null }))
      .filter((a) => a.rut.length > 0);
    setBusy(true);
    try {
      const res = await fetch("/api/reembolsadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          glosa: glosa.trim(),
          aliases: cleanAliases,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Error al crear");
        return;
      }
      setItems((arr) =>
        [...arr, body].sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      setNombre("");
      setGlosa("");
      setNewAliases([{ rut: "", businessName: "" }]);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setError(null);
    const cleanAliases = editAliases
      .map((a) => ({ rut: a.rut.trim(), businessName: a.businessName?.trim() || null }))
      .filter((a) => a.rut.length > 0);
    setBusy(true);
    try {
      const res = await fetch(`/api/reembolsadores/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: editNombre.trim(),
          glosa: editGlosa.trim(),
          aliases: cleanAliases,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Error al guardar");
        return;
      }
      setItems((arr) =>
        arr
          .map((x) => (x.id === editingId ? body : x))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      cancelEdit();
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Borrar este reembolsador?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reembolsadores/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Error al borrar");
        return;
      }
      setItems((arr) => arr.filter((x) => x.id !== id));
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Form de creación */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      >
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Agregar reembolsador
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cristobal · Jose Perez"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Glosa que matchea (case-insensitive)
            </label>
            <input
              type="text"
              value={glosa}
              onChange={(e) => setGlosa(e.target.value)}
              placeholder="cristobal · jose perez"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              disabled={busy}
            />
          </div>
        </div>

        <AliasListEditor
          aliases={newAliases}
          onChange={setNewAliases}
          disabled={busy}
        />

        <div className="flex items-center justify-end pt-2 border-t border-gray-100">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>

        {error && !editingId && <p className="text-xs text-red-700">{error}</p>}

        <div className="text-[11px] text-gray-500 leading-relaxed space-y-1.5 pt-2 border-t border-gray-100">
          <p>
            <span className="font-medium">Reembolsador clásico</span> (sin RUT
            empresa): cuando la glosa matchea, asumimos que la factura puede ser
            de cualquier proveedor (compras que la persona pagó con su tarjeta).
          </p>
          <p>
            <span className="font-medium">Con alias de empresa</span> (uno o
            varios RUTs): cuando la glosa matchea, el modal filtra
            automáticamente las facturas por esos RUTs. Útil cuando le pagás a
            la persona pero las facturas las emite su empresa o un proveedor
            recurrente. Si la persona compra en varios lugares (ej. Cristóbal
            en Paula Johanna O Sodimac), agregás ambos.
          </p>
        </div>
      </form>

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Todavía no hay reembolsadores. Agregá el primero arriba.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 w-44">Nombre</th>
                <th className="text-left px-4 py-2 w-40">Glosa</th>
                <th className="text-left px-4 py-2">Empresas alias</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((r) => {
                if (editingId === r.id) {
                  return (
                    <tr key={r.id} className="bg-gray-50 align-top">
                      <td className="px-4 py-3" colSpan={4}>
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                Nombre
                              </label>
                              <input
                                type="text"
                                value={editNombre}
                                onChange={(e) => setEditNombre(e.target.value)}
                                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                                disabled={busy}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                Glosa
                              </label>
                              <input
                                type="text"
                                value={editGlosa}
                                onChange={(e) => setEditGlosa(e.target.value)}
                                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                                disabled={busy}
                              />
                            </div>
                          </div>
                          <AliasListEditor
                            aliases={editAliases}
                            onChange={setEditAliases}
                            disabled={busy}
                          />
                          {error && (
                            <p className="text-xs text-red-700">{error}</p>
                          )}
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={busy}
                              className="text-xs text-gray-600 hover:text-gray-900"
                            >
                              cancelar
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={busy}
                              className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
                            >
                              Guardar
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                // Aliases efectivos: lista nueva, fallback al legacy.
                const effectiveAliases =
                  r.aliases && r.aliases.length > 0
                    ? r.aliases
                    : r.rutAlias
                      ? [
                          {
                            rut: r.rutAlias,
                            businessName: r.businessName ?? null,
                          },
                        ]
                      : [];
                return (
                  <tr key={r.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2 text-gray-900 font-medium">
                      {r.nombre}
                    </td>
                    <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                      {r.glosa}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {effectiveAliases.length === 0 ? (
                        <span className="text-gray-300">
                          — (compras de cualquier proveedor)
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {effectiveAliases.map((a, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5"
                            >
                              <span className="text-gray-900">
                                {a.businessName ?? a.rut}
                              </span>
                              {a.businessName && (
                                <span className="text-gray-400 font-mono">
                                  {a.rut}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        disabled={busy}
                        className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        disabled={busy}
                        className="text-xs text-gray-400 hover:text-rose-700 disabled:opacity-50"
                      >
                        borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Sub-componente: editor de una lista de aliases (rut + businessName).
 * Permite agregar/quitar filas. Usado tanto en el form de creación como
 * en el modo edición inline.
 */
function AliasListEditor({
  aliases,
  onChange,
  disabled,
}: {
  aliases: Alias[];
  onChange: (next: Alias[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<Alias>) {
    onChange(aliases.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function remove(idx: number) {
    const next = aliases.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : [{ rut: "", businessName: "" }]);
  }
  function add() {
    onChange([...aliases, { rut: "", businessName: "" }]);
  }
  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">
          Empresas alias{" "}
          <span className="text-gray-400">
            (opcional · una o varias · ej. proveedor a quien siempre compra)
          </span>
        </p>
      </div>
      {aliases.map((a, idx) => (
        <div
          key={idx}
          className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-end"
        >
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">
              RUT empresa
            </label>
            <input
              type="text"
              value={a.rut}
              onChange={(e) => update(idx, { rut: e.target.value })}
              placeholder="77270733-9"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">
              Nombre empresa
            </label>
            <input
              type="text"
              value={a.businessName ?? ""}
              onChange={(e) => update(idx, { businessName: e.target.value })}
              placeholder="Paula Johanna SpA"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className="text-xs text-gray-400 hover:text-rose-700 disabled:opacity-50 px-2 py-1.5"
            title="Quitar este alias"
          >
            quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
      >
        + agregar otro alias
      </button>
    </div>
  );
}
