"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCLP } from "@/lib/utils";

type ImportStats = {
  file: string;
  account: { alias: string; number: string };
  cartolaNumber: string;
  fechaDesde: string;
  fechaHasta: string;
  saldoInicial: number;
  saldoFinal: number;
  total: number;
  created: number;
  duplicates: number;
  autoMatchedInvoices: number;
  internalTransfersDetected: number;
  categorized: number;
};

// Botón "Importar cartola" — drag-drop o click. Al subir el archivo,
// llama a POST /api/banco/import y muestra resumen del resultado.
export default function ImportCartolaButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/banco/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al importar");
        setBusy(false);
        return;
      }
      setResult(data.stats);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = ""; // reset para permitir re-import del mismo archivo
          }}
          className="hidden"
        />
        <span
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
            busy
              ? "bg-gray-100 text-gray-400"
              : "bg-gray-900 text-white hover:bg-gray-800"
          }`}
        >
          {busy ? "Procesando…" : "↓ Importar cartola"}
        </span>
      </label>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ {error}
        </div>
      )}

      {result && (
        <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 space-y-0.5">
          <p className="text-sm font-semibold text-gray-900 mb-1">
            ✓ {result.account.alias} · cartola #{result.cartolaNumber} ({result.fechaDesde?.slice(0, 10)} — {result.fechaHasta?.slice(0, 10)})
          </p>
          <p className="text-gray-700">
            Saldo final: <span className="font-medium tabular-nums">{formatCLP(result.saldoFinal)}</span>
          </p>
          <p className="text-gray-600 pt-1">
            <span className="text-gray-900 font-medium">{result.created}</span> movimientos nuevos
            {result.duplicates > 0 && (
              <span className="text-gray-500"> · {result.duplicates} duplicados (ignorados)</span>
            )}
          </p>
          <p className="text-gray-600">
            {result.autoMatchedInvoices > 0 && (
              <span className="text-green-700">
                {result.autoMatchedInvoices} factura{result.autoMatchedInvoices > 1 ? "s" : ""} conciliada{result.autoMatchedInvoices > 1 ? "s" : ""} ✓
              </span>
            )}
            {result.internalTransfersDetected > 0 && (
              <span className="text-gray-500"> · {result.internalTransfersDetected} transferencia(s) interna(s)</span>
            )}
            {result.categorized > 0 && (
              <span className="text-gray-500"> · {result.categorized} categorizado(s) automáticamente</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
