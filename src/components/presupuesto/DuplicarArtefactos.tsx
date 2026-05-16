"use client";

import { useEffect, useMemo, useState } from "react";

// Cotización de artefactos que se puede usar como origen.
interface Fuente {
  id: string;
  version: string;
  status: string;
  date: string;
  projectId: string;
  projectName: string;
  clientName: string;
  itemCount: number;
}

// Item de artefacto tal como lo devuelve la API — mismo shape que usa el
// editor para su estado local.
export interface ImportedArtefacto {
  id: string;
  room: string;
  subcategory: string;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null;
  clientPrice: number;
  realCostBlarq: number | null;
  referenceLink: string | null;
  imageUrl: string | null;
  catalogId: string | null;
  sortOrder: number;
}

interface ImportReport {
  copied: number;
  priceUpdated: number;
  imageUpdated: number;
  pendientes: { name: string; motivo: string }[];
  items: ImportedArtefacto[];
}

function fmtDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/**
 * Modal "Traer de otra cotización" para artefactos.
 *
 * MJ elige una cotización de artefactos de otro proyecto (o de otra
 * versión) y la duplica entera dentro de la actual. Al duplicar, los
 * precios se refrescan online — porque traer una cotización vieja casi
 * siempre arrastra precios desactualizados.
 */
export default function DuplicarArtefactos({
  budgetId,
  onClose,
  onDone,
}: {
  budgetId: string;
  onClose: () => void;
  onDone: (items: ImportedArtefacto[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshPrices, setRefreshPrices] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/presupuestos/${budgetId}/artefactos/fuentes`
        );
        const data = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || "Error al cargar cotizaciones.");
          return;
        }
        setFuentes(data);
      } catch {
        if (!cancel) setLoadError("No se pudieron cargar las cotizaciones.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fuentes;
    return fuentes.filter(
      (f) =>
        f.projectName.toLowerCase().includes(q) ||
        f.clientName.toLowerCase().includes(q)
    );
  }, [fuentes, query]);

  async function handleDuplicate() {
    if (!selected) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/artefactos/importar-de`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceBudgetId: selected,
            refreshPrices,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || "Error al duplicar.");
        return;
      }
      setReport(data);
    } catch {
      setImportError("Error al duplicar la cotización.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Traer de otra cotización
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Duplica los artefactos de otra cotización dentro de esta. Se
            copian nombre, marca, detalle, link e imagen; los precios se
            actualizan a los del momento.
          </p>
        </div>

        {/* Cuerpo */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {/* Si ya se duplicó, mostramos el reporte */}
          {report ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-900">
                Se duplicaron <strong>{report.copied}</strong> artefacto
                {report.copied === 1 ? "" : "s"}.
              </div>
              {refreshPrices && (
                <div className="text-xs text-gray-600">
                  {report.priceUpdated} precio
                  {report.priceUpdated === 1 ? "" : "s"} actualizado
                  {report.priceUpdated === 1 ? "" : "s"} ·{" "}
                  {report.imageUpdated} imagen
                  {report.imageUpdated === 1 ? "" : "es"} agregada
                  {report.imageUpdated === 1 ? "" : "s"}.
                </div>
              )}
              {report.pendientes.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1.5">
                    Revisá estos a mano ({report.pendientes.length})
                  </div>
                  <ul className="space-y-1">
                    {report.pendientes.map((p, i) => (
                      <li key={i} className="text-xs text-amber-700">
                        <span className="font-medium">{p.name}</span> —{" "}
                        {p.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              {loading && (
                <div className="text-sm text-gray-500 py-8 text-center">
                  Cargando cotizaciones…
                </div>
              )}

              {!loading && loadError && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {loadError}
                </div>
              )}

              {!loading && !loadError && fuentes.length === 0 && (
                <div className="text-sm text-gray-500 py-8 text-center">
                  No hay otras cotizaciones de artefactos para duplicar.
                </div>
              )}

              {!loading && fuentes.length > 0 && (
                <>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por proyecto o mandante…"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs outline-none focus:border-gray-500 mb-3"
                  />
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {filtered.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSelected(f.id)}
                        className={`w-full grid grid-cols-[minmax(0,1fr)_5rem_4rem_4rem] gap-3 items-center px-3 py-2.5 border-b border-gray-100 last:border-b-0 text-xs text-left hover:bg-gray-50 ${
                          selected === f.id ? "bg-gray-100" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {f.projectName}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate">
                            {f.clientName}
                          </div>
                        </div>
                        <div className="text-gray-600 uppercase tracking-wider text-[10px]">
                          {f.version} · {f.status}
                        </div>
                        <div className="text-gray-500 tabular-nums text-[10px]">
                          {fmtDate(f.date)}
                        </div>
                        <div className="text-right tabular-nums text-gray-700">
                          {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
                        </div>
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-3 py-4 text-xs text-gray-500 text-center">
                        Sin resultados.
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-xs text-gray-600 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={refreshPrices}
                      onChange={(e) => setRefreshPrices(e.target.checked)}
                      className="accent-gray-900"
                    />
                    Actualizar precios online al duplicar (recomendado)
                  </label>
                </>
              )}

              {importError && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                  {importError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          {report ? (
            <button
              onClick={() => onDone(report.items)}
              className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
            >
              Listo
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="text-xs text-gray-600 px-3 py-2 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={handleDuplicate}
                disabled={!selected || importing}
                className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {importing
                  ? refreshPrices
                    ? "Duplicando y revisando precios…"
                    : "Duplicando…"
                  : "Duplicar acá"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
