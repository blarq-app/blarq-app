"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SOCIOS } from "@/lib/banco/socios";

// Selector "¿de qué socio?" para un préstamo/devolución cuya contraparte NO es
// el socio. Caso real: BLARQ le pagó $500k a un tercero (Rojas Mella) porque JT
// no tenía plata en su cuenta — la glosa dice "Rojas Mella", pero el que le debe
// a BLARQ es JT, y el banco no puede saberlo solo.
//
// Solo se muestra cuando hace falta: si la transferencia va derecho a MJ o JT,
// la contraparte ya dice quién es y no molestamos con un selector de más.
// Sin marcar, el movimiento no se le atribuye a nadie en el recuadro de saldos
// (antes se le cargaba al tercero, como si fuera socio).
export default function SocioPrestamoSelect({
  movimientoId,
  socioRut,
}: {
  movimientoId: string;
  socioRut: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(socioRut ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(socioRut ?? "");
  }, [socioRut]);

  async function onChange(next: string) {
    if (busy) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socioRut: next || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo guardar el socio");
        setValue(prev);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      title="¿De qué socio es este préstamo? (la plata fue a un tercero)"
      className={`text-force-10 normal-case tracking-normal border rounded px-1 py-0.5 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 cursor-pointer disabled:opacity-50 ${
        value
          ? "border-gray-300 text-gray-700"
          : "border-amber-300 text-amber-800 bg-amber-50"
      }`}
    >
      <option value="">¿De qué socio?</option>
      {SOCIOS.map((s) => (
        <option key={s.rut} value={s.rut}>
          {s.nombre}
        </option>
      ))}
    </select>
  );
}
