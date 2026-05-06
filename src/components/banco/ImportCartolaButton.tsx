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

type Outcome =
  | { fileName: string; ok: true; stats: ImportStats }
  | { fileName: string; ok: false; error: string };

// Botón "Importar cartola" — soporta varios archivos a la vez. Cada uno
// se procesa secuencialmente contra POST /api/banco/import. La cuenta
// (Operativa / Sueldos) se detecta automáticamente del número de cuenta
// que viene dentro del Excel — no hace falta seleccionarla.
export default function ImportCartolaButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Progreso para feedback durante batch (procesando 3/6, etc).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  async function handleFiles(files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    setOutcomes([]);
    setProgress({ done: 0, total: files.length });

    const collected: Outcome[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/banco/import", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          collected.push({ fileName: file.name, ok: false, error: data.error ?? "Error" });
        } else {
          collected.push({ fileName: file.name, ok: true, stats: data.stats });
        }
      } catch (e) {
        collected.push({
          fileName: file.name,
          ok: false,
          error: e instanceof Error ? e.message : "Error de red",
        });
      }
      setProgress({ done: i + 1, total: files.length });
      setOutcomes([...collected]);
    }

    setBusy(false);
    router.refresh();
  }

  // Agregados para el resumen final cuando son varios archivos.
  const successes = outcomes.filter((o): o is Outcome & { ok: true } => o.ok);
  const failures = outcomes.filter((o): o is Outcome & { ok: false } => !o.ok);
  const totalCreated = successes.reduce((s, o) => s + o.stats.created, 0);
  const totalDuplicates = successes.reduce((s, o) => s + o.stats.duplicates, 0);
  const totalConciliadas = successes.reduce(
    (s, o) => s + o.stats.autoMatchedInvoices,
    0
  );
  const totalInternas = successes.reduce(
    (s, o) => s + o.stats.internalTransfersDetected,
    0
  );

  return (
    <div className="space-y-3">
      <label className="block">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          disabled={busy}
          onChange={(e) => {
            const fl = e.target.files;
            if (!fl || fl.length === 0) return;
            handleFiles(Array.from(fl));
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
          {busy
            ? progress
              ? `Procesando ${progress.done}/${progress.total}…`
              : "Procesando…"
            : "↓ Importar cartola(s)"}
        </span>
      </label>

      {/* Resumen agregado cuando son varias */}
      {outcomes.length > 1 && (
        <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <p className="text-sm font-semibold text-gray-900 mb-1">
            {successes.length} de {outcomes.length} cartolas importadas
            {failures.length > 0 ? ` · ${failures.length} con error` : ""}
          </p>
          <p className="text-gray-700">
            <span className="font-medium tabular-nums">{totalCreated}</span> movimientos nuevos
            {totalDuplicates > 0 && (
              <span className="text-gray-500"> · {totalDuplicates} duplicados ignorados</span>
            )}
          </p>
          {(totalConciliadas > 0 || totalInternas > 0) && (
            <p className="text-gray-600">
              {totalConciliadas > 0 && (
                <span className="text-green-700">
                  {totalConciliadas} factura{totalConciliadas > 1 ? "s" : ""} conciliada{totalConciliadas > 1 ? "s" : ""} ✓
                </span>
              )}
              {totalInternas > 0 && (
                <span className="text-gray-500">
                  {totalConciliadas > 0 ? " · " : ""}{totalInternas} transferencia(s) interna(s)
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Detalle por archivo (cuando son pocos) */}
      {outcomes.length > 0 && outcomes.length <= 6 && (
        <div className="space-y-2">
          {outcomes.map((o, idx) => (
            <div
              key={idx}
              className={`text-xs border rounded-lg px-3 py-2.5 space-y-0.5 ${
                o.ok
                  ? "bg-gray-50 border-gray-200"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {o.ok ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">
                    ✓ {o.stats.account.alias} · cartola #{o.stats.cartolaNumber} (
                    {o.stats.fechaDesde?.slice(0, 10)} — {o.stats.fechaHasta?.slice(0, 10)})
                  </p>
                  <p className="text-gray-700">
                    Saldo final:{" "}
                    <span className="font-medium tabular-nums">
                      {formatCLP(o.stats.saldoFinal)}
                    </span>
                  </p>
                  <p className="text-gray-600 pt-1">
                    <span className="text-gray-900 font-medium">{o.stats.created}</span>{" "}
                    movimientos nuevos
                    {o.stats.duplicates > 0 && (
                      <span className="text-gray-500"> · {o.stats.duplicates} duplicados</span>
                    )}
                    {o.stats.autoMatchedInvoices > 0 && (
                      <span className="text-green-700">
                        {" "}· {o.stats.autoMatchedInvoices} factura{o.stats.autoMatchedInvoices > 1 ? "s" : ""} conciliada{o.stats.autoMatchedInvoices > 1 ? "s" : ""}
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p>
                  ⚠ {o.fileName}: {o.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
