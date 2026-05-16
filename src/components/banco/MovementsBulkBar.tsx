"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

type SelectedMovement = {
  id: string;
  amount: number;
  hasPayments: boolean;
};

type Factura = {
  id: string;
  folioNumber: string | null;
  businessName: string | null;
  totalAmount: number;
  paid: number;
  remaining: number;
  status: string;
  issueDate: string;
  projectName: string | null;
};

// Barra flotante de acciones masivas para /banco/movimientos.
// Aparece abajo-centro cuando hay movimientos seleccionados. Dos acciones:
//   - Desasignar: quita las imputaciones de los movs (vuelven a pendiente).
//   - Asignar a factura: imputa cada mov elegido a una factura emitida,
//     cada uno como un pago por su monto completo.
export default function MovementsBulkBar({
  selected,
  onClear,
}: {
  selected: SelectedMovement[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (selected.length === 0 && !toast) return null;

  const ids = selected.map((m) => m.id);
  // Monto total: signo neto (ingresos − egresos), por si MJ mezcló.
  const neto = selected.reduce((s, m) => s + m.amount, 0);
  const conPagos = selected.filter((m) => m.hasPayments).length;

  async function desasignar() {
    if (busy) return;
    if (
      !confirm(
        `¿Quitar las imputaciones de ${ids.length} movimiento${ids.length !== 1 ? "s" : ""}?\n\n` +
          `Los movimientos vuelven a "Pendiente". Las facturas que pierdan ` +
          `el cobro recalculan su estado. No se borra ningún movimiento — ` +
          `solo se deshace la conciliación.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "desasignar", movementIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Error al desasignar");
        return;
      }
      setToast(
        `Listo · ${data.desasignados} movimiento${data.desasignados !== 1 ? "s" : ""} desasignado${data.desasignados !== 1 ? "s" : ""}`
      );
      onClear();
      router.refresh();
      setTimeout(() => setToast(null), 8000);
    } finally {
      setBusy(false);
    }
  }

  async function asignar(invoiceId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "asignar", movementIds: ids, invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Error al asignar");
        return;
      }
      setToast(
        `Listo · ${data.asignados} movimiento${data.asignados !== 1 ? "s" : ""} asignado${data.asignados !== 1 ? "s" : ""} a la factura`
      );
      setPickerOpen(false);
      onClear();
      router.refresh();
      setTimeout(() => setToast(null), 8000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]">
        {selected.length > 0 && !toast && (
          <div className="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium tabular-nums">
              {selected.length} seleccionado{selected.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-gray-400 tabular-nums">
              neto {formatCLP(neto)}
            </span>
            <span className="text-xs text-gray-500">·</span>

            <button
              onClick={desasignar}
              disabled={busy || conPagos === 0}
              title={
                conPagos === 0
                  ? "Ninguno de los seleccionados tiene imputaciones que quitar"
                  : `Quita las imputaciones de ${conPagos} movimiento(s)`
              }
              className="text-xs bg-white text-gray-900 px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
            >
              {busy ? "Procesando…" : `Desasignar${conPagos > 0 ? ` (${conPagos})` : ""}`}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              Asignar a factura…
            </button>
            <button
              onClick={onClear}
              disabled={busy}
              className="text-xs text-gray-300 hover:text-white px-2"
            >
              Cancelar
            </button>
          </div>
        )}

        {toast && (
          <div className="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
            <span className="text-sm">{toast}</span>
            <button
              onClick={() => setToast(null)}
              className="text-xs text-gray-400 hover:text-white px-1"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {pickerOpen && (
        <InvoicePickerModal
          movementCount={selected.length}
          totalNeto={neto}
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onPick={asignar}
        />
      )}
    </>
  );
}

// Modal para elegir UNA factura emitida a la que imputar los movimientos
// seleccionados. Reusa /api/facturas/search restringido a emitidas.
function InvoicePickerModal({
  movementCount,
  totalNeto,
  busy,
  onClose,
  onPick,
}: {
  movementCount: number;
  totalNeto: number;
  busy: boolean;
  onClose: () => void;
  onPick: (invoiceId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  const [results, setResults] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", "emitida");
      if (q.trim()) params.set("q", q.trim());
      params.set("onlyWithBalance", onlyWithBalance ? "1" : "0");
      const res = await fetch(`/api/facturas/search?${params.toString()}`);
      if (!res.ok) {
        setError("Error en la búsqueda");
        return;
      }
      const data = await res.json();
      setResults(data.facturas ?? []);
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, [q, onlyWithBalance]);

  useEffect(() => {
    const t = setTimeout(search, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Asignar a factura emitida
            </h2>
            <p className="text-xs text-gray-500 mt-1 tabular-nums">
              {movementCount} movimiento{movementCount !== 1 ? "s" : ""} · neto{" "}
              {formatCLP(totalNeto)}. Cada uno se imputa por su monto completo
              como un pago de la factura.
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

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Buscar folio, nombre, RUT o monto…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="flex-1 min-w-[240px] px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            />
            <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithBalance}
                onChange={(e) => setOnlyWithBalance(e.target.checked)}
              />
              Solo con saldo
            </label>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-4 text-center text-xs text-gray-500">Buscando…</div>
            ) : error ? (
              <div className="p-4 text-center text-xs text-rose-700">{error}</div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500">
                Sin resultados.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Folio</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Proyecto</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((f) => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 tabular-nums text-gray-700 whitespace-nowrap">
                        F-{f.folioNumber}
                      </td>
                      <td className="px-3 py-2 text-gray-700 truncate max-w-[180px]">
                        {f.businessName ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-500 truncate max-w-[140px]">
                        {f.projectName ?? (
                          <span className="italic text-gray-300">sin asignar</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {formatCLP(f.totalAmount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                        {formatCLP(f.remaining)}
                        {f.status === "parcial" && (
                          <div className="text-[9px] uppercase text-blue-700">
                            parcial
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => onPick(f.id)}
                          disabled={busy}
                          className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800 disabled:opacity-50"
                        >
                          {busy ? "…" : "Elegir"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
