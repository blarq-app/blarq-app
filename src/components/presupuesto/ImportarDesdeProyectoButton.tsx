"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botón "Importar desde otro proyecto" — abre un modal con la lista de
// proyectos que tienen al menos una versión Obra cargada. Al elegir uno,
// se clona la última versión Obra como punto de partida en el proyecto
// actual: misma estructura de partidas, pero cantidades en 0 y precios
// refrescados del catálogo (no del snapshot del proyecto fuente).
//
// Pensado para el caso de uso "tengo una cotización nueva y quiero
// arrancar desde una estructura típica" — donde la mayoría de las
// partidas son las mismas que en proyectos anteriores.

export type SourceProject = {
  id: string;
  name: string;
  latestObraBudgetId: string;
  latestObraVersion: string;
  partidasCount: number;
};

export default function ImportarDesdeProyectoButton({
  projectId,
  sources,
}: {
  projectId: string;
  sources: SourceProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (sources.length === 0) return null;

  async function importar() {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch("/api/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type: "obra",
          baseVersionId: selected,
          resetQuantities: true,
          refreshFromCatalog: true,
        }),
      });
      if (!res.ok) throw new Error("Error al importar");
      const budget = await res.json();
      router.push(`/proyectos/${projectId}/presupuesto/${budget.id}`);
      router.refresh();
    } catch {
      alert("Error al importar partidas");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-500 px-3 py-2 rounded-lg transition-colors"
      >
        Importar desde otro proyecto
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">
                Importar partidas desde otro proyecto
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Crea una versión Obra nueva con la misma estructura del
                proyecto elegido. Cantidades se ponen en 0 y los precios se
                refrescan del catálogo actual.
              </p>
            </div>

            <div className="overflow-y-auto flex-1">
              {sources.map((s) => (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                    selected === s.latestObraBudgetId ? "bg-gray-50" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    value={s.latestObraBudgetId}
                    checked={selected === s.latestObraBudgetId}
                    onChange={() => setSelected(s.latestObraBudgetId)}
                    className="accent-gray-900"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 text-sm">
                      {s.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      Obra {s.latestObraVersion} · {s.partidasCount} partidas
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={importar}
                disabled={!selected || loading}
                className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {loading ? "Importando..." : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
