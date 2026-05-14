"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ImportResult {
  budgetVersionId: string;
  version: string;
  summary: {
    totalItems: number;
    groups: { group: string; count: number }[];
  };
  warnings: string[];
}

const GROUP_LABELS: Record<string, string> = {
  "sanitario / bano_principal": "Sanitarios — baño principal",
  "sanitario / bano_secundario": "Sanitarios — baño secundario",
  "sanitario / bano_visita": "Sanitarios — baño visita",
  "sanitario / otro": "Sanitarios — otro baño",
  "cocina / cocina": "Cocina",
  "iluminacion / otro": "Iluminación",
};

/**
 * Botón para importar artefactos desde un Excel (formato MK / TEKA /
 * LedStudio). Crea automáticamente una versión nueva de presupuesto
 * artefactos (borrador) con todos los items parseados, agrupados por
 * habitación cuando el Excel los separa.
 */
export default function ImportarArtefactosButton({
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
      const res = await fetch(
        `/api/proyectos/${projectId}/importar-artefactos`,
        {
          method: "POST",
          body: form,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al importar artefactos");
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
    router.push(
      `/proyectos/${projectId}/presupuesto/${result.budgetVersionId}`
    );
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
        {uploading ? "Importando…" : "Importar artefactos"}
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
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {error}
                  </p>
                </>
              )}
              {result && (
                <>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">
                    Artefactos importados — {result.version}
                  </h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Se creó el presupuesto {result.version} con{" "}
                    <span className="font-semibold text-gray-900">
                      {result.summary.totalItems}
                    </span>{" "}
                    artefactos.
                  </p>

                  <div className="mb-4">
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                      Desglose
                    </h3>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {result.summary.groups.map((g) => (
                            <tr
                              key={g.group}
                              className="border-b border-gray-200 last:border-b-0"
                            >
                              <td className="py-1.5 px-3 text-gray-800">
                                {GROUP_LABELS[g.group] ?? g.group}
                              </td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-gray-900 font-medium">
                                {g.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

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
