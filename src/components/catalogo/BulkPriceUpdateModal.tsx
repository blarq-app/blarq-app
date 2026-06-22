"use client";

import { useState } from "react";
import { formatCLP } from "@/lib/utils";

interface Mat {
  id: string;
  name: string;
  unit: string;
  netPrice: number;
  referenceLink: string | null;
}

type Status = "pending" | "checking" | "changed" | "same" | "error";

interface Row {
  status: Status;
  newNet?: number;
  source?: string;
  error?: string;
  selected: boolean;
}

// Cuántas tiendas consultamos a la vez. Bajo a propósito: las tiendas pueden
// bloquear si las golpeamos en paralelo agresivo, y total esto corre una vez
// cada tanto, no es algo de uso intensivo.
const CONCURRENCY = 4;

// Revisa el precio actual en la web (Sodimac/Easy/mK) de una tanda de
// materiales con link, usando el mismo scraping que el botón por fila. No
// guarda nada hasta que MJ confirma: muestra antes → después de los que
// cambiaron y aplica solo los tildados.
export default function BulkPriceUpdateModal({
  materials,
  onClose,
  onApplied,
}: {
  materials: Mat[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    materials.map(() => ({ status: "pending" as Status, selected: true }))
  );
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "applying">(
    "idle"
  );
  const [progress, setProgress] = useState(0);
  // Cuántos materiales se están guardando en la tanda actual. Sirve para que
  // la barra de "Guardando…" mida sobre el total real que se aplica (los
  // tildados), no sobre todos los materiales revisados.
  const [applyTotal, setApplyTotal] = useState(0);
  const [showErrors, setShowErrors] = useState(false);

  const patch = (i: number, p: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  async function run() {
    setPhase("running");
    setProgress(0);
    let completed = 0;
    const queue = materials.map((_, i) => i);

    async function worker() {
      while (queue.length) {
        const i = queue.shift();
        if (i === undefined) break;
        patch(i, { status: "checking" });
        const mat = materials[i];
        try {
          const res = await fetch("/api/catalogo/fetch-price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: mat.referenceLink }),
          });
          const data = await res.json();
          if (!res.ok) {
            patch(i, { status: "error", error: data.error || "No se pudo leer" });
          } else {
            const newNet = Math.round(data.netPrice);
            if (newNet === mat.netPrice) {
              patch(i, { status: "same", newNet, source: data.source });
            } else {
              patch(i, {
                status: "changed",
                newNet,
                source: data.source,
                selected: true,
              });
            }
          }
        } catch {
          patch(i, { status: "error", error: "Error de red" });
        }
        completed++;
        setProgress(completed);
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setPhase("done");
  }

  async function apply() {
    const toApply = materials
      .map((mat, i) => ({ mat, row: rows[i] }))
      .filter(({ row }) => row.status === "changed" && row.selected);
    // El guardado es uno por uno (cada material además se propaga a las
    // partidas que lo usan), así que tarda. La barra mide el avance REAL
    // sobre los que se aplican, no se queda pegada en 100% como antes.
    setApplyTotal(toApply.length);
    setProgress(0);
    setPhase("applying");
    let saved = 0;
    for (const { mat, row } of toApply) {
      try {
        await fetch(`/api/catalogo/materiales/${mat.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: mat.name,
            unit: mat.unit,
            netPrice: row.newNet,
            referenceLink: mat.referenceLink || null,
          }),
        });
      } catch {
        // Si una falla, seguimos con las demás. El refetch al cerrar muestra
        // el estado real de lo que sí se guardó.
      }
      saved++;
      setProgress(saved);
    }
    onApplied();
    onClose();
  }

  const changed = materials
    .map((mat, i) => ({ mat, row: rows[i], i }))
    .filter(({ row }) => row.status === "changed");
  const sameCount = rows.filter((r) => r.status === "same").length;
  const errorRows = materials
    .map((mat, i) => ({ mat, row: rows[i] }))
    .filter(({ row }) => row.status === "error");
  const selectedCount = changed.filter(({ row }) => row.selected).length;
  // Durante el guardado el denominador es la tanda que se aplica; durante la
  // revisión es el total de materiales con link.
  const pctTotal = phase === "applying" ? applyTotal : materials.length;
  const pct = pctTotal ? Math.round((progress / pctTotal) * 100) : 0;

  // Mientras guarda no se puede cerrar: cortar a la mitad deja unos guardados
  // y otros no. La X, el clic afuera y la tecla quedan inertes hasta terminar.
  const requestClose = () => {
    if (phase === "applying") return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex justify-center items-start py-10 px-4 overflow-y-auto"
      onClick={requestClose}
    >
      <div
        className="w-[640px] max-w-full bg-white rounded-xl shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Actualizar precios desde la web
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Revisa el precio actual en Sodimac, Easy y mK de los{" "}
              {materials.length} materiales con link.
            </p>
          </div>
          <button
            onClick={requestClose}
            disabled={phase === "applying"}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {phase === "idle" && (
            <div className="text-center py-6">
              {materials.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No hay materiales con link de Sodimac, Easy o mK para
                  actualizar en esta vista.
                </p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Se van a revisar {materials.length} materiales. Puede tardar
                    un par de minutos y algunos pueden fallar (la tienda bloquea
                    o el producto ya no está). No se guarda nada hasta que
                    confirmes los cambios.
                  </p>
                  <button
                    onClick={run}
                    className="bg-gray-900 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-gray-700"
                  >
                    Empezar revisión
                  </button>
                </>
              )}
            </div>
          )}

          {(phase === "running" || phase === "applying") && (
            <div className="py-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>
                  {phase === "applying"
                    ? `Guardando ${progress} de ${applyTotal}…`
                    : `Revisando ${progress} de ${materials.length}…`}
                </span>
                <span className="tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-900 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {phase === "running" && (
                <p className="text-xs text-gray-400 mt-2 tabular-nums">
                  {changed.length} con cambio · {sameCount} sin cambio ·{" "}
                  {errorRows.length} no se pudo
                </p>
              )}
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 tabular-nums">
                <strong>{changed.length}</strong> con cambio · {sameCount} sin
                cambio · {errorRows.length} no se pudo leer
              </p>

              {changed.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No hay precios para actualizar.
                </p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[45vh] overflow-y-auto">
                  {changed.map(({ mat, row, i }) => (
                    <label
                      key={mat.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => patch(i, { selected: e.target.checked })}
                        className="shrink-0"
                      />
                      <span
                        className="flex-1 min-w-0 text-sm text-gray-800 truncate"
                        title={mat.name}
                      >
                        {mat.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                        {row.source}
                      </span>
                      <span className="text-sm tabular-nums text-gray-400 line-through shrink-0">
                        {formatCLP(mat.netPrice)}
                      </span>
                      <span className="text-gray-300 shrink-0">→</span>
                      <span
                        className={`text-sm tabular-nums font-semibold shrink-0 ${
                          (row.newNet ?? 0) > mat.netPrice
                            ? "text-red-600"
                            : "text-green-700"
                        }`}
                      >
                        {formatCLP(row.newNet ?? 0)}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {errorRows.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowErrors((v) => !v)}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    {showErrors ? "− " : "+ "}Ver los {errorRows.length} que no se
                    pudieron leer
                  </button>
                  {showErrors && (
                    <ul className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                      {errorRows.map(({ mat, row }) => (
                        <li
                          key={mat.id}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                        >
                          <span
                            className="truncate text-gray-600"
                            title={mat.name}
                          >
                            {mat.name}
                          </span>
                          <span className="text-red-500 shrink-0">
                            {row.error}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === "done" && (
          <div className="flex items-center justify-between p-5 border-t border-gray-200">
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Cerrar sin guardar
            </button>
            <button
              onClick={apply}
              disabled={selectedCount === 0}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium ${
                selectedCount > 0
                  ? "bg-gray-900 text-white hover:bg-gray-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              Aplicar {selectedCount} {selectedCount === 1 ? "cambio" : "cambios"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
