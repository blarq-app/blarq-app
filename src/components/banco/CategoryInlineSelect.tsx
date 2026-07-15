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
//
// Además (enableGastoEmpresa): el mismo desplegable ofrece "registrar como
// Boleta / Internacional". A diferencia de re-categorizar, esto CREA un
// documento de gasto (Invoice 1043) y concilia el movimiento — pasa a ser un
// gasto de empresa que aparece en Contabilidad → Gastos para declarar en el
// F22. Como mueve plata, pide confirmación. La obra/categoría del gasto se
// asignan después en Gastos (viven en el documento, no en el movimiento).

// Valores centinela para las opciones que registran gasto (no son categorías).
const REG_BOLETA = "__reg_boleta";
const REG_INTERNACIONAL = "__reg_internacional";

export default function CategoryInlineSelect({
  movimientoId,
  category,
  options,
  enableGastoEmpresa = false,
}: {
  movimientoId: string;
  category: string | null;
  options: { value: string; label: string }[];
  enableGastoEmpresa?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(category ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(category ?? "");
  }, [category]);

  // Registrar el movimiento como gasto de empresa (boleta / internacional).
  // Crea el documento sin obra/categoría (se catalogan en Gastos) y concilia.
  async function registrarGasto(tipoGasto: "boleta" | "internacional") {
    const etiqueta = tipoGasto === "boleta" ? "boleta" : "gasto internacional";
    if (
      !confirm(
        `¿Registrar este movimiento como ${etiqueta}?\n\n` +
          `Se crea el gasto y queda conciliado. Aparece en Contabilidad → ` +
          `Gastos, donde le asignás obra y categoría (y la foto). Lo podés ` +
          `deshacer desde el movimiento con "Desasignar".`
      )
    ) {
      setValue(category ?? "");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "registrar_gasto",
          movementIds: [movimientoId],
          tipoGasto,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "No se pudo registrar el gasto");
        setValue(category ?? "");
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
      setValue(category ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function onChange(next: string) {
    if (busy || !next || next === value) return;
    // Opciones que registran gasto (no son categorías).
    if (next === REG_BOLETA) return registrarGasto("boleta");
    if (next === REG_INTERNACIONAL) return registrarGasto("internacional");

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
      title="Cambiar la categoría, o registrarlo como gasto de empresa (boleta / internacional)"
      className="max-w-[150px] text-force-10 uppercase tracking-wide border border-gray-300 rounded px-1 py-0.5 text-gray-700 bg-white outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 disabled:opacity-50 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {enableGastoEmpresa && (
        <optgroup label="Registrar con boleta o comprobante">
          <option value={REG_INTERNACIONAL}>Internacional…</option>
          <option value={REG_BOLETA}>Boleta…</option>
        </optgroup>
      )}
    </select>
  );
}
