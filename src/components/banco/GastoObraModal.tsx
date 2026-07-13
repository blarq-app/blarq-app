"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

// Modal unificado "Gasto de obra sin factura". Junta lo que antes eran DOS
// botones separados en la barra negra:
//   - "Pago sin factura"  → pago a un maestro/proveedor que no emite documento.
//   - "Registrar gasto"   → boleta o compra internacional (sin IVA).
// Por debajo los dos crean EL MISMO registro: un costo de la obra (Invoice
// tipoDoc 1043, iva 0, conciliado contra el movimiento). La única diferencia
// es la etiqueta de RESPALDO, que sirve para separarlos en los impuestos:
//   - sin respaldo  → action "pago_sin_factura"  (origin sin_respaldo)
//   - boleta        → action "registrar_gasto" tipoGasto=boleta
//   - internacional → action "registrar_gasto" tipoGasto=internacional
// Elegir el respaldo acá decide a qué acción del endpoint /bulk se llama; no
// hay cambio de plumbing ni de plata respecto de los dos botones viejos.
//
// OJO: esto es SOLO para costos de una OBRA. Los gastos propios de BLARQ
// (sueldo, retiro, previred, impuestos…) NO son costo de obra y van por otro
// camino — la opción "Sueldo, retiro, previred…" del menú Resolver.
type Respaldo = "sin_respaldo" | "boleta" | "internacional";

export default function GastoObraModal({
  movementIds,
  movementCount,
  totalNeto,
  projects,
  categories,
  onClose,
  onDone,
}: {
  movementIds: string[];
  movementCount: number;
  totalNeto: number;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
  onClose: () => void;
  // Se llama tras un guardado exitoso (para limpiar selección en la barra).
  onDone?: () => void;
}) {
  const router = useRouter();
  const [respaldo, setRespaldo] = useState<Respaldo>("sin_respaldo");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const OPCIONES_RESPALDO: { value: Respaldo; label: string; hint: string }[] = [
    {
      value: "sin_respaldo",
      label: "Sin respaldo",
      hint: "Pago a un maestro/proveedor que no emite documento.",
    },
    {
      value: "boleta",
      label: "Boleta",
      hint: "Compra con boleta (no da crédito de IVA).",
    },
    {
      value: "internacional",
      label: "Internacional",
      hint: "Servicio del exterior (Claude, Google…). Sin IVA chileno.",
    },
  ];

  async function guardar() {
    if (busy || !projectId || !categoryId) return;
    setBusy(true);
    setError(null);
    try {
      // El respaldo decide la acción del endpoint /bulk.
      const body =
        respaldo === "sin_respaldo"
          ? { action: "pago_sin_factura", movementIds, projectId, categoryId }
          : {
              action: "registrar_gasto",
              movementIds,
              projectId,
              categoryId,
              tipoGasto: respaldo,
            };
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar el gasto de obra");
        return;
      }
      onDone?.();
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Gasto de obra sin factura
            </h2>
            <p className="text-xs text-gray-500 mt-1 tabular-nums">
              {movementCount} movimiento{movementCount !== 1 ? "s" : ""} · neto{" "}
              {formatCLP(totalNeto)}. Cada egreso se registra como un costo de
              la obra (sin IVA) y queda conciliado con el movimiento.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tipo de respaldo
            </label>
            <div className="grid grid-cols-3 gap-2">
              {OPCIONES_RESPALDO.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRespaldo(o.value)}
                  className={`text-xs px-2 py-2 rounded border ${
                    respaldo === o.value
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {OPCIONES_RESPALDO.find((o) => o.value === respaldo)?.hint}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Obra / centro de costo
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            >
              <option value="">Elegí una obra…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.numeroProyecto ? `${p.numeroProyecto} · ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Las suscripciones de la oficina van al proyecto interno de BLARQ.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Categoría
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            >
              <option value="">Elegí una categoría…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Para pagos a maestros suele ser Mano de obra o Subcontrato.
            </p>
          </div>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs text-gray-600 px-3 py-2 hover:text-gray-900"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={busy || !projectId || !categoryId}
            className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "Registrando…" : "Registrar gasto de obra"}
          </button>
        </div>
      </div>
    </div>
  );
}
