"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface NotMatched {
  chapter: string;
  subChapter: string | null;
  name: string;
  quantity: number;
  unit: string;
}

interface ImportResult {
  budgetVersionId: string;
  version: string;
  summary: {
    totalItems: number;
    matched: number;
    notMatched: number;
    notMatchedList: NotMatched[];
  };
  warnings: string[];
}

/**
 * Botón para importar un Excel de cubicación entregado por JP. Crea
 * automáticamente una nueva versión de presupuesto obra (borrador) con
 * los ítems del Excel matcheados contra el catálogo. Los no-matched
 * quedan en el presupuesto con unitPrice=0 para que MJ los termine de
 * armar.
 */
export default function ImportarCubicacionButton({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/proyectos/${projectId}/importar-cubicacion`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al importar cubicación");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function openBudget() {
    if (!result) return;
    router.push(`/proyectos/${projectId}/presupuesto/${result.budgetVersionId}`);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={onFile}
        className="hidden"
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-500 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        {uploading ? "Importando…" : "Importar cubicación"}
      </button>

      {/* Modal de resultado */}
      {(result || error) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setResult(null);
            setError(null);
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              {error && (
                <>
                  <h2 className="text-lg font-bold text-red-700 mb-2">
                    Error al importar
                  </h2>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{error}</p>
                </>
              )}
              {result && (
                <>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">
                    Cubicación importada — {result.version}
                  </h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Se creó el presupuesto {result.version} con{" "}
                    <span className="font-semibold text-gray-900">
                      {result.summary.totalItems}
                    </span>{" "}
                    ítems del Excel.
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="text-xs uppercase tracking-wider text-green-700">
                        Matcheados al catálogo
                      </div>
                      <div className="text-2xl font-bold text-green-800 tabular-nums">
                        {result.summary.matched}
                      </div>
                      <div className="text-xs text-green-700/70 mt-0.5">
                        Vienen con precio y descripción del catálogo.
                      </div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="text-xs uppercase tracking-wider text-amber-700">
                        Sin match
                      </div>
                      <div className="text-2xl font-bold text-amber-800 tabular-nums">
                        {result.summary.notMatched}
                      </div>
                      <div className="text-xs text-amber-700/70 mt-0.5">
                        Quedan con precio $0 — revisar y completar.
                      </div>
                    </div>
                  </div>

                  {result.summary.notMatchedList.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                        Partidas sin match en el catálogo
                      </h3>
                      <div className="bg-gray-50 rounded-lg border border-gray-200 max-h-60 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-100 sticky top-0">
                            <tr className="text-gray-600 uppercase tracking-wider text-[10px]">
                              <th className="text-left py-1.5 px-2 font-medium">Capítulo</th>
                              <th className="text-left py-1.5 px-2 font-medium">Sub</th>
                              <th className="text-left py-1.5 px-2 font-medium">Partida</th>
                              <th className="text-right py-1.5 px-2 font-medium">Cant.</th>
                              <th className="text-left py-1.5 px-2 font-medium">Un.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.summary.notMatchedList.map((nm, idx) => (
                              <tr
                                key={idx}
                                className="border-t border-gray-200"
                              >
                                <td className="py-1 px-2 text-gray-700">
                                  {nm.chapter}
                                </td>
                                <td className="py-1 px-2 text-gray-500">
                                  {nm.subChapter ?? "—"}
                                </td>
                                <td className="py-1 px-2 text-gray-900">{nm.name}</td>
                                <td className="py-1 px-2 text-right tabular-nums text-gray-700">
                                  {nm.quantity}
                                </td>
                                <td className="py-1 px-2 text-gray-500">{nm.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {result.warnings.length > 0 && (
                    <ul className="text-xs text-amber-700 mb-4 list-disc pl-4">
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                  className="text-sm text-gray-700 border border-gray-300 hover:border-gray-500 px-3 py-1.5 rounded-lg"
                >
                  Cerrar
                </button>
                {result && (
                  <button
                    type="button"
                    onClick={openBudget}
                    className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800"
                  >
                    Abrir presupuesto
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
