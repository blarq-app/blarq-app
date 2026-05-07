"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Reembolsador = {
  id: string;
  nombre: string;
  glosa: string;
};

export default function ReembolsadoresEditor({
  initial,
}: {
  initial: Reembolsador[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [nombre, setNombre] = useState("");
  const [glosa, setGlosa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim() || !glosa.trim()) {
      setError("Nombre y glosa son obligatorios");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/reembolsadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), glosa: glosa.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Error al crear");
        return;
      }
      setItems((arr) => [...arr, body].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombre("");
      setGlosa("");
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
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cristobal"
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
              placeholder="cristobal"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              disabled={busy}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <p className="text-[11px] text-gray-500 leading-relaxed">
          La glosa se busca como substring en la descripción del banco. Por
          ejemplo, si la glosa es <span className="font-mono bg-gray-100 px-1">cristobal</span>,
          va a matchear movimientos con descripción &quot;Transf a Cristobal Alej&quot; o
          &quot;Pago Cristobal&quot;. Mantenerlo simple — solo el primer nombre suele
          alcanzar.
        </p>
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
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Glosa</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-900 font-medium">{r.nombre}</td>
                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">{r.glosa}</td>
                  <td className="px-4 py-2 text-right">
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
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
