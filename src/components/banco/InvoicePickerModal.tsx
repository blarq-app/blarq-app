"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";

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

// Modal para elegir UNA factura a la que imputar los movimientos
// seleccionados (uno o varios). Cada movimiento se imputa por su monto
// completo como un pago de la factura. Reusa /api/facturas/search.
//
// Antes vivía embebido dentro de MovementsBulkBar. Se extrajo a su propio
// archivo para que el menú "Resolver" lo use tanto en la barra de selección
// (varios movs → una factura) como en cualquier otro punto que lo necesite.
// El movimiento individual usa MovementReconcileModal (más rico: permite
// repartir un mov en varias facturas); este modal es para el caso inverso
// (varios movs → la misma factura).
export default function InvoicePickerModal({
  movementCount,
  totalNeto,
  sharedCounterpartyRut,
  busy,
  onClose,
  onPick,
}: {
  movementCount: number;
  totalNeto: number;
  // Si todos los movs seleccionados son de la misma contraparte (cliente
  // o proveedor), su RUT viene aquí. El modal arranca con filtro "Mismo
  // cliente" ENCENDIDO; MJ puede apagarlo si quiere ver todas.
  sharedCounterpartyRut: string | null;
  busy: boolean;
  onClose: () => void;
  onPick: (invoiceId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  // Si hay contraparte compartida, el filtro arranca prendido.
  const [filterSameClient, setFilterSameClient] = useState(
    !!sharedCounterpartyRut
  );
  const [results, setResults] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monto absoluto del lote — se pasa al endpoint para que ordene por
  // proximidad de saldo. La factura cuyo saldo coincide con el total del
  // lote queda arriba (ej. 2 movs de Camila por $6.811.589 → la factura
  // emitida F-162 a Camila con saldo $6.811.589 sale primera).
  const absTotal = Math.abs(totalNeto);

  // El tipo de factura se decide por el signo del neto del lote:
  //   - Egresos (neto < 0) → buscamos facturas RECIBIDAS (proveedores).
  //   - Ingresos (neto > 0) → buscamos facturas EMITIDAS (clientes).
  const facturaType: "emitida" | "recibida" = totalNeto >= 0 ? "emitida" : "recibida";

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", facturaType);
      if (q.trim()) params.set("q", q.trim());
      params.set("onlyWithBalance", onlyWithBalance ? "1" : "0");
      if (absTotal > 0) params.set("amount", String(absTotal));
      if (filterSameClient && sharedCounterpartyRut) {
        params.set("counterpartyRut", sharedCounterpartyRut);
      }
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
  }, [q, onlyWithBalance, absTotal, filterSameClient, sharedCounterpartyRut, facturaType]);

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
              Asignar a factura {facturaType}
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
            {sharedCounterpartyRut && (
              <label
                className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer"
                title={`Mostrar solo facturas ${facturaType === "emitida" ? "emitidas a este cliente" : "recibidas de este proveedor"}`}
              >
                <input
                  type="checkbox"
                  checked={filterSameClient}
                  onChange={(e) => setFilterSameClient(e.target.checked)}
                />
                Mismo {facturaType === "emitida" ? "cliente" : "proveedor"}
              </label>
            )}
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
                    <th className="text-left px-3 py-2">{facturaType === "emitida" ? "Cliente" : "Proveedor"}</th>
                    <th className="text-left px-3 py-2">Proyecto</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((f) => {
                    // Match cuando el saldo de la factura es igual al total
                    // neto del lote (±$10). La fila se resalta en verde para
                    // que salte a la vista — es la candidata mas probable.
                    const isMatch =
                      absTotal > 0 && Math.abs(f.remaining - absTotal) <= 10;
                    return (
                      <tr
                        key={f.id}
                        className={
                          isMatch
                            ? "bg-emerald-50 hover:bg-emerald-100"
                            : "hover:bg-gray-50"
                        }
                      >
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
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span
                            className={
                              isMatch
                                ? "text-emerald-700 font-semibold"
                                : "text-gray-900"
                            }
                          >
                            {formatCLP(f.remaining)}
                          </span>
                          {f.status === "parcial" && (
                            <div className="text-[9px] uppercase text-amber-700">
                              parcial
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => onPick(f.id)}
                            disabled={busy}
                            className={
                              "text-xs text-white px-2 py-0.5 rounded disabled:opacity-50 " +
                              (isMatch
                                ? "bg-emerald-700 hover:bg-emerald-800"
                                : "bg-gray-900 hover:bg-gray-800")
                            }
                          >
                            {busy ? "…" : "Elegir"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
