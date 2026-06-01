"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Detalle de un match (espejo del MatchDetail del endpoint).
interface MatchDetail {
  paymentId: string;
  invoiceId: string;
  folioNumber: string | null;
  businessName: string | null;
  invoiceTotal: number;
  amountApplied: number;
  movDate: string;
  movAmount: number;
  movDescription: string;
}

interface ConciliarResult {
  tried: number;
  matched: number;
  byReason: Record<string, number>;
  matches: MatchDetail[];
}

function fmt(n: number): string {
  return "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
}

function fmtFecha(iso: string): string {
  // dd-mm-yyyy, sin librería de fechas.
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

// Botón que dispara POST /api/banco/auto-conciliar-pendientes y, tras correr,
// muestra un panel REVISABLE con lo que concilió: cada match (factura ↔
// movimiento) con su detalle y un botón "deshacer" que llama al DELETE del
// payment. Pensado para el control de MJ: la conciliación automática puede
// equivocarse, así que mostrar qué hizo + permitir revertir en el momento
// respeta la regla "conciliación conservadora: manual antes que mal hecho".
export default function AutoConciliarPendientesButton({
  pendientesCount,
}: {
  pendientesCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConciliarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // paymentIds que MJ ya deshizo desde el panel (para tacharlos al instante).
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setUndone(new Set());
    try {
      const res = await fetch("/api/banco/auto-conciliar-pendientes", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setResult(data as ConciliarResult);
      // OJO: NO llamar router.refresh() acá. El refresh revalida los datos
      // del servidor y re-renderiza la página, lo que desmonta el panel de
      // resultados antes de que MJ alcance a revisarlo. En cambio refrescamos
      // al CERRAR el panel (cerrarPanel) o al deshacer un match — momentos en
      // que MJ ya terminó de mirar y quiere ver la lista actualizada.
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  // Cierra el panel y recién ahí refresca la tabla de movimientos (que ahora
  // muestra los recién conciliados con su nuevo estado).
  function cerrarPanel() {
    setResult(null);
    router.refresh();
  }

  async function deshacer(m: MatchDetail) {
    if (undoing) return;
    setUndoing(m.paymentId);
    try {
      const res = await fetch(
        `/api/facturas/${m.invoiceId}/payments/${m.paymentId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setUndone((prev) => new Set(prev).add(m.paymentId));
        // No refrescamos acá: tachamos la fila en el panel (opacity) y
        // dejamos el refresh para cuando MJ cierre el panel, así no se
        // desmonta mientras sigue revisando los demás matches.
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No se pudo deshacer");
      }
    } catch {
      setError("Error de red al deshacer");
    } finally {
      setUndoing(null);
    }
  }

  const matches = result?.matches ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {error && (
          <span className="text-xs text-red-600 whitespace-nowrap">{error}</span>
        )}
        {result && matches.length === 0 && (
          <span className="text-xs text-gray-600 whitespace-nowrap">
            {result.tried} probados, ninguno conció
          </span>
        )}
        <button
          onClick={handleClick}
          disabled={busy || pendientesCount === 0}
          className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            pendientesCount === 0
              ? "No hay movimientos pendientes de conciliar"
              : `Busca facturas pendientes con saldo similar para los ${pendientesCount} mov pendientes`
          }
        >
          {busy
            ? "Conciliando…"
            : `Auto-conciliar pendientes (${pendientesCount})`}
        </button>
      </div>

      {/* Panel revisable: lo que se concilió en esta corrida. */}
      {result && matches.length > 0 && (
        <div className="w-full max-w-2xl border border-gray-200 rounded-xl bg-white overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-900">
              Se conciliaron {matches.length}{" "}
              {matches.length === 1 ? "factura" : "facturas"} — revisá
            </span>
            <button
              onClick={cerrarPanel}
              className="text-xs text-gray-400 hover:text-gray-700"
              title="Cerrar y actualizar la tabla"
            >
              Cerrar
            </button>
          </div>
          <ul className="divide-y divide-gray-100">
            {matches.map((m) => {
              const isUndone = undone.has(m.paymentId);
              // Señal de atención: el monto del movimiento difiere del total
              // de la factura (calzó por saldo parcial o tolerancia). No es
              // error, pero merece una mirada.
              const montoDistinto =
                Math.round(Math.abs(m.movAmount)) !== Math.round(m.invoiceTotal);
              return (
                <li
                  key={m.paymentId}
                  className={`px-3 py-2 flex items-center justify-between gap-3 text-xs ${
                    isUndone ? "opacity-40" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/facturas/${m.invoiceId}`}
                        className="font-medium text-gray-900 hover:underline truncate"
                      >
                        {m.businessName ?? "—"}
                        {m.folioNumber ? ` · folio ${m.folioNumber}` : ""}
                      </a>
                      {montoDistinto && !isUndone && (
                        <span
                          className="text-[10px] text-amber-600 whitespace-nowrap"
                          title="El monto del movimiento no coincide con el total de la factura"
                        >
                          revisar monto
                        </span>
                      )}
                    </div>
                    <div className="text-gray-500 truncate tabular-nums">
                      {fmtFecha(m.movDate)} · mov {fmt(m.movAmount)} →
                      factura {fmt(m.invoiceTotal)}
                      <span className="text-gray-400 truncate">
                        {" · "}
                        {m.movDescription}
                      </span>
                    </div>
                  </div>
                  {isUndone ? (
                    <span className="text-gray-400 whitespace-nowrap">
                      deshecha
                    </span>
                  ) : (
                    <button
                      onClick={() => deshacer(m)}
                      disabled={undoing === m.paymentId}
                      className="text-gray-500 hover:text-red-600 whitespace-nowrap disabled:opacity-50"
                      title="Deshacer esta conciliación"
                    >
                      {undoing === m.paymentId ? "…" : "deshacer"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
