"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

// Decimal es-CL (coma) con hasta `dec` cifras — para la UF (40.610,69) y el
// tope de salud en UF, que perderían precisión si se redondearan a entero.
function fmtDec(n: number, dec = 2): string {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dec,
  }).format(n);
}

// UTM es siempre un entero de pesos.
function fmtEntero(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n);
}

type Indicador = {
  id: string;
  year: number;
  month: number;
  uf: number;
  utm: number;
  gratificacionTopeMensual: number;
  topeImponibleSaludUF: number;
};

export default function IndicadoresEditor({
  year,
  month,
  mesNombre,
  indicador,
}: {
  year: number;
  month: number;
  mesNombre: string;
  indicador: Indicador | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado editable de los topes.
  const [gratif, setGratif] = useState(
    indicador?.gratificacionTopeMensual ?? 0
  );
  const [topeSalud, setTopeSalud] = useState(
    indicador?.topeImponibleSaludUF ?? 0
  );
  const [editando, setEditando] = useState(false);

  // Traer indicadores del mes (UF/UTM de internet + topes arrastrados).
  async function traer(refetch = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contabilidad/indicadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, refetch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "No se pudo traer la UF/UTM");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function guardarTopes() {
    if (!indicador) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contabilidad/indicadores/${indicador.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gratificacionTopeMensual: gratif,
          topeImponibleSaludUF: topeSalud,
        }),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      setEditando(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!indicador) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Indicadores de {mesNombre} {year}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              La UF y la UTM se traen solas de internet. Los topes se arrastran
              del mes anterior y quedan editables.
            </p>
          </div>
          <button
            onClick={() => traer(false)}
            disabled={busy}
            className="shrink-0 px-3 py-1.5 rounded bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "Trayendo…" : "Traer indicadores"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Indicadores de {mesNombre} {year}
        </h2>
        <button
          onClick={() => traer(true)}
          disabled={busy}
          className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"
        >
          {busy ? "Actualizando…" : "Actualizar UF/UTM de internet"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100">
        <Dato etiqueta="UF (cierre de mes)" valor={fmtDec(indicador.uf, 2)} sub="automática" />
        <Dato etiqueta="UTM" valor={fmtEntero(indicador.utm)} sub="automática" />

        {/* Tope gratificación */}
        <div className="px-5 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">
            Tope gratificación
          </p>
          {editando ? (
            <input
              type="number"
              value={gratif}
              onChange={(e) => setGratif(Number(e.target.value))}
              className="mt-1 w-full text-sm tabular-nums border border-gray-300 rounded px-2 py-1"
            />
          ) : (
            <p className="text-sm font-semibold text-gray-900 tabular-nums mt-1">
              {formatCLP(indicador.gratificacionTopeMensual)}
            </p>
          )}
        </div>

        {/* Tope salud */}
        <div className="px-5 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">
            Tope salud (UF)
          </p>
          {editando ? (
            <input
              type="number"
              step="0.01"
              value={topeSalud}
              onChange={(e) => setTopeSalud(Number(e.target.value))}
              className="mt-1 w-full text-sm tabular-nums border border-gray-300 rounded px-2 py-1"
            />
          ) : (
            <p className="text-sm font-semibold text-gray-900 tabular-nums mt-1">
              {fmtDec(indicador.topeImponibleSaludUF, 2)}
            </p>
          )}
        </div>
      </div>

      <div className="px-5 py-2.5 border-t border-gray-100 flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
        {editando ? (
          <>
            <button
              onClick={() => {
                setEditando(false);
                setGratif(indicador.gratificacionTopeMensual);
                setTopeSalud(indicador.topeImponibleSaludUF);
              }}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Cancelar
            </button>
            <button
              onClick={guardarTopes}
              disabled={busy}
              className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              Guardar topes
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditando(true)}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Editar topes
          </button>
        )}
      </div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  sub,
}: {
  etiqueta: string;
  valor: string;
  sub?: string;
}) {
  return (
    <div className="px-5 py-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">
        {etiqueta}
      </p>
      <p className="text-sm font-semibold text-gray-900 tabular-nums mt-1">
        {valor}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
