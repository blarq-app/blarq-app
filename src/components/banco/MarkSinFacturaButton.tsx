"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Atajo inline "Sin factura": marca un movimiento como sin_factura con una
// categoría (sueldo, previred, etc.) sin crear factura ficticia ni proyecto.
// Es el equivalente manual de lo que las reglas hacen solas al importar.
//
// Pega al PATCH /api/banco/movimientos/[id] con { category, saveRule }.
// "Guardar regla" arranca APAGADO: crear regla deriva un patrón de la glosa
// que puede quedar amplio (ej "Transf a Juan"), así que es decisión explícita.

// Categorías que de verdad no llevan documento tributario. Se excluyen
// compra_tarjeta (método de pago, deprecado en ronda 48) y transfer_interno
// (eso lo cubre el botón "↔ Interna").
const OPCIONES: { value: string; label: string }[] = [
  { value: "sueldo", label: "Sueldo" },
  { value: "retiro_personal", label: "Retiro socio" },
  { value: "bono_socio", label: "Bono socio" },
  { value: "prestamo_socio", label: "Préstamo socio" },
  { value: "previred", label: "Previred" },
  { value: "comision_bancaria", label: "Comisión banco" },
  { value: "deposito_efectivo", label: "Depósito efectivo" },
  { value: "impuestos", label: "Impuestos" },
  { value: "otro_sin_factura", label: "Otro" },
];

export default function MarkSinFacturaButton({
  movimientoId,
}: {
  movimientoId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveRule, setSaveRule] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function marcar(category: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, saveRule }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? "no se pudo marcar"}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="text-[11px] text-gray-500 hover:text-gray-900 underline whitespace-nowrap disabled:opacity-50"
        title="Marcar como gasto sin factura (sueldo, previred, etc.) — no crea factura ni usa un proyecto"
      >
        {busy ? "…" : "Sin factura"}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-sm py-1">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400">
            Categoría
          </p>
          {OPCIONES.map((o) => (
            <button
              key={o.value}
              onClick={() => marcar(o.value)}
              disabled={busy}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
          <label className="flex items-start gap-1.5 px-3 pt-2 pb-1.5 mt-1 border-t border-gray-100 text-[11px] text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={saveRule}
              onChange={(e) => setSaveRule(e.target.checked)}
              className="mt-0.5 accent-gray-900"
            />
            <span>
              Guardar regla
              <span className="block text-[10px] text-gray-400">
                Etiqueta solas las próximas con glosa parecida.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
