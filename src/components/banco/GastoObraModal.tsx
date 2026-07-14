"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

// Modal para registrar un costo de una OBRA sin factura. Dos variantes, según
// desde qué opción del menú Resolver se abre:
//   - variant="pago"  → "Pago a obra sin factura": pago a un maestro/proveedor
//     que no emite documento. action /bulk "pago_sin_factura".
//   - variant="gasto" → "Registrar gasto": boleta o compra internacional
//     (sin IVA). Pide el tipo (boleta | internacional). action "registrar_gasto".
// Por debajo los dos crean un costo de la obra (Invoice tipoDoc 1043, iva 0,
// conciliado contra el movimiento); cambia el `origin` según el caso. No hay
// cambio de plumbing ni de plata respecto de los botones viejos de la barra.
//
// OJO: esto es SOLO para costos de una OBRA. Los gastos propios de BLARQ
// (sueldo, retiro, previred…) NO son costo de obra y van por otro camino —
// la opción "Sueldo, retiro, previred…" del menú Resolver.
type Variant = "pago" | "gasto";
type TipoGasto = "boleta" | "internacional";

export default function GastoObraModal({
  variant,
  movementIds,
  movementCount,
  totalNeto,
  projects,
  categories,
  onClose,
  onDone,
}: {
  variant: Variant;
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
  const [tipoGasto, setTipoGasto] = useState<TipoGasto>("boleta");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esPago = variant === "pago";
  const titulo = esPago ? "Pago a obra sin factura" : "Registrar gasto";
  const submitLabel = esPago ? "Registrar pago sin factura" : "Registrar gasto";
  const descripcion = esPago
    ? "Cada egreso se registra como un costo de la obra (sin documento tributario) y queda conciliado con el movimiento."
    : "Para gastos que no llegan como factura del SII. Cuenta el total como costo de la obra (sin IVA) y queda conciliado con el movimiento.";

  async function guardar() {
    if (busy || !projectId || !categoryId) return;
    setBusy(true);
    setError(null);
    try {
      const body = esPago
        ? { action: "pago_sin_factura", movementIds, projectId, categoryId }
        : {
            action: "registrar_gasto",
            movementIds,
            projectId,
            categoryId,
            tipoGasto,
          };
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar");
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
            <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
            <p className="text-xs text-gray-500 mt-1 tabular-nums">
              {movementCount} movimiento{movementCount !== 1 ? "s" : ""} · neto{" "}
              {formatCLP(totalNeto)}. {descripcion}
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
          {!esPago && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Tipo de gasto
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTipoGasto("boleta")}
                  className={`text-xs px-3 py-2 rounded border ${
                    tipoGasto === "boleta"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Boleta
                </button>
                <button
                  type="button"
                  onClick={() => setTipoGasto("internacional")}
                  className={`text-xs px-3 py-2 rounded border ${
                    tipoGasto === "internacional"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Internacional
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {tipoGasto === "boleta"
                  ? "Compra con boleta (no da crédito de IVA)."
                  : "Servicio del exterior (Claude, Google…). Sin IVA chileno."}
              </p>
            </div>
          )}

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
            {esPago && (
              <p className="text-[11px] text-gray-400 mt-1">
                Para pagos a maestros suele ser Mano de obra o Subcontrato.
              </p>
            )}
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
            {busy ? "Registrando…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
