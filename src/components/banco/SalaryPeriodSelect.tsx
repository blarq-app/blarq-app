"use client";

import { useEffect, useState } from "react";
import {
  toYearMonth,
  shiftYearMonth,
  defaultSalaryPeriod,
} from "@/lib/banco/salaryPeriod";
import { useSenalGuardado, claseSenal, SenalGuardado } from "./senalGuardado";

// Selector "a qué mes corresponde" para un sueldo/previred. El pago cae en el
// banco cuando MJ transfiere, pero en el Estado de Resultados debe imputarse al
// mes que corresponde. Value vacío = "Auto": usa el default por fecha (que se
// muestra en la etiqueta) y el movimiento queda con salaryPeriod=null. Elegir un
// mes concreto lo fija (override). Ofrecemos el mes del pago y los 3 anteriores,
// que cubre los pagos hechos con atraso.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function label(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES[m - 1]} ${String(y).slice(2)}`;
}

export default function SalaryPeriodSelect({
  movimientoId,
  category,
  date,
  salaryPeriod,
}: {
  movimientoId: string;
  category: string | null;
  date: string; // ISO
  salaryPeriod: string | null;
}) {
  const [value, setValue] = useState(salaryPeriod ?? "");
  const { busy, confirmado, setSaving, refrescarYConfirmar } =
    useSenalGuardado();

  useEffect(() => {
    setValue(salaryPeriod ?? "");
  }, [salaryPeriod]);

  const d = new Date(date);
  const def = defaultSalaryPeriod(category, d);
  // Opciones: mes del pago y los 3 anteriores (más nuevo arriba).
  const payYm = toYearMonth(d);
  const opciones = [0, -1, -2, -3].map((k) => shiftYearMonth(payYm, k));

  async function onChange(next: string) {
    if (busy) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salaryPeriod: next || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo marcar el mes");
        setValue(prev);
        return;
      }
      refrescarYConfirmar();
    } catch {
      alert("Error de red");
      setValue(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        title="A qué mes corresponde este pago (para el Estado de Resultados)"
        className={`text-force-10 border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 disabled:opacity-50 ${claseSenal(
          confirmado,
          value
            ? "border-gray-300 text-gray-700"
            : "border-gray-200 text-gray-400"
        )}`}
      >
        <option value="">Auto ({label(def)})</option>
        {opciones.map((ym) => (
          <option key={ym} value={ym}>
            {label(ym)}
          </option>
        ))}
      </select>
      <SenalGuardado busy={busy} confirmado={confirmado} />
    </span>
  );
}
