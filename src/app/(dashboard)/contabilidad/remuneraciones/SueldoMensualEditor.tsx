"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

type SueldoMes = {
  empleadoId: string;
  nombre: string;
  rut: string;
  estandar: number;
  efectivo: number;
  ajustado: boolean;
};

// Sueldo imponible (base + bono) de cada empleado para el mes. Por default usa
// el estándar; se edita acá cuando ese mes cambió (ej. bono distinto). Cambiar
// el valor recalcula la liquidación y el código 048 del mes.
export default function SueldoMensualEditor({
  sueldos,
  year,
  month,
  mesNombre,
}: {
  sueldos: SueldoMes[];
  year: number;
  month: number;
  mesNombre: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
      <div className="px-5 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">
          Sueldo imponible · {mesNombre} {year}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Base + bono de cada empleado. Por default toma el sueldo estándar;
          editalo si este mes cambió.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {sueldos.map((s) => (
          <Fila key={s.empleadoId} sueldo={s} year={year} month={month} />
        ))}
        {sueldos.length === 0 && (
          <div className="px-5 py-4 text-sm text-gray-400">
            No hay empleados activos.
          </div>
        )}
      </div>
    </div>
  );
}

function Fila({
  sueldo,
  year,
  month,
}: {
  sueldo: SueldoMes;
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(sueldo.efectivo);
  const [busy, setBusy] = useState(false);

  const cambiado = valor !== sueldo.efectivo;
  const esEstandar = valor === sueldo.estandar;

  async function guardar() {
    setBusy(true);
    try {
      // Si lo dejan igual al estándar, borramos el ajuste (vuelve al estándar).
      if (esEstandar) {
        await fetch(
          `/api/contabilidad/sueldo-mensual?empleadoId=${sueldo.empleadoId}&year=${year}&month=${month}`,
          { method: "DELETE" }
        );
      } else {
        await fetch("/api/contabilidad/sueldo-mensual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            empleadoId: sueldo.empleadoId,
            year,
            month,
            sueldoBase: valor,
          }),
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function volverEstandar() {
    setBusy(true);
    try {
      await fetch(
        `/api/contabilidad/sueldo-mensual?empleadoId=${sueldo.empleadoId}&year=${year}&month=${month}`,
        { method: "DELETE" }
      );
      setValor(sueldo.estandar);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-gray-900">{sueldo.nombre}</span>
          {sueldo.ajustado && (
            <span className="text-[10px] uppercase tracking-wide text-amber-700 border border-amber-200 bg-amber-50 rounded-full px-1.5">
              ajustado
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 tabular-nums">
          Estándar {formatCLP(sueldo.estandar)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          value={valor}
          onChange={(e) => setValor(Number(e.target.value))}
          className="w-36 text-sm tabular-nums text-right border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-gray-900"
        />
        {sueldo.ajustado && esEstandar ? (
          <button
            onClick={volverEstandar}
            disabled={busy}
            className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            Quitar ajuste
          </button>
        ) : (
          <button
            onClick={guardar}
            disabled={busy || !cambiado}
            className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
          >
            {busy ? "…" : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );
}
