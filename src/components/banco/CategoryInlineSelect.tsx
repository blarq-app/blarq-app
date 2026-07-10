"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Edición inline de la categoría de un movimiento SIN FACTURA (ej. corregir
// uno que quedó como "Sueldo" y es "Préstamo socio"). Antes, una vez marcado
// "sin factura" no había forma de cambiarlo desde la UI: el menú de categorías
// solo aparecía en estado pendiente/parcial. Acá se edita en la misma celda de
// Imputación con un desplegable. PATCH { category } al endpoint del movimiento
// (el mismo que usa MarkSinFacturaButton); el status sigue "sin_factura".
//
// Re-categorizar cambia en qué sección del Estado de Resultados cae el
// movimiento (sueldo vs retiro vs préstamo, etc.), así que después del PATCH
// refrescamos para que el Resumen/EERR se recalculen.
export default function CategoryInlineSelect({
  movimientoId,
  category,
  options,
}: {
  movimientoId: string;
  category: string | null;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(category ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(category ?? "");
  }, [category]);

  async function onChange(next: string) {
    if (busy || !next || next === value) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo cambiar la categoría");
        setValue(prev);
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      title="Cambiar la categoría de este movimiento sin factura"
      className="max-w-[150px] text-xs border border-gray-300 rounded px-1.5 py-1 text-gray-700 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 disabled:opacity-50 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
