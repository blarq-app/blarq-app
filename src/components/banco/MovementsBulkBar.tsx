"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";

type SelectedMovement = {
  id: string;
  amount: number;
  hasPayments: boolean;
  // RUT de la contraparte (cliente que pagó / proveedor al que pagamos).
  // Se usa en el modal "Asignar a factura emitida" para priorizar facturas
  // del mismo cliente. Si todos los movs seleccionados comparten contraparte,
  // el modal filtra por ese RUT.
  counterpartyRut?: string | null;
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
// Aparece abajo-centro cuando hay movimientos seleccionados. Acciones:
//   - Desasignar: quita las imputaciones de los movs (vuelven a pendiente).
//   - Asignar a factura: imputa cada mov elegido a una factura emitida,
//     cada uno como un pago por su monto completo.
//   - Pago sin factura: para egresos a maestros/proveedores que no emiten
//     documento. Crea un registro de costo "sin respaldo" por cada mov y
//     lo asigna a un proyecto + categoría.
export default function MovementsBulkBar({
  selected,
  onClear,
  projects,
  categories,
}: {
  selected: SelectedMovement[];
  onClear: () => void;
  projects: { id: string; name: string }[];
  categories: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sinFacturaOpen, setSinFacturaOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (selected.length === 0 && !toast) return null;

  const ids = selected.map((m) => m.id);
  // Monto total: signo neto (ingresos − egresos), por si MJ mezcló.
  const neto = selected.reduce((s, m) => s + m.amount, 0);
  const conPagos = selected.filter((m) => m.hasPayments).length;
  // Elegible para "devolución neto cero": ≥2 movs, ninguno ya conciliado,
  // hay al menos una entrada y una salida, y el neto se cancela (≈ 0).
  const netoCeroElegible =
    selected.length >= 2 &&
    conPagos === 0 &&
    selected.some((m) => m.amount > 0) &&
    selected.some((m) => m.amount < 0) &&
    Math.abs(neto) <= 10;

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

  async function marcarNetoCero() {
    if (busy) return;
    if (
      !confirm(
        `¿Marcar estos ${ids.length} movimientos como devolución (neto cero)?\n\n` +
          `Son plata que entró y volvió (se cancelan entre sí). Salen de ` +
          `"pendiente" y NO cuentan como ingreso ni gasto. Lo podés deshacer ` +
          `después con "deshacer" en cualquiera de los movimientos.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "neto_cero", movementIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Error al marcar neto cero");
        return;
      }
      setToast(
        `Listo · ${data.neteados} movimiento${data.neteados !== 1 ? "s" : ""} marcado${data.neteados !== 1 ? "s" : ""} como devolución (neto cero)`
      );
      onClear();
      router.refresh();
      setTimeout(() => setToast(null), 8000);
    } finally {
      setBusy(false);
    }
  }

  async function pagoSinFactura(projectId: string, categoryId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/banco/movimientos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pago_sin_factura",
          movementIds: ids,
          projectId,
          categoryId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Error al registrar el pago sin factura");
        return;
      }
      const partes = [
        `${data.creados} pago${data.creados !== 1 ? "s" : ""} sin factura registrado${data.creados !== 1 ? "s" : ""}`,
      ];
      if (data.omitidos > 0) {
        partes.push(
          `${data.omitidos} omitido${data.omitidos !== 1 ? "s" : ""} (ya asignados o no son egresos)`
        );
      }
      setToast(`Listo · ${partes.join(" · ")}`);
      setSinFacturaOpen(false);
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
              onClick={() => setSinFacturaOpen(true)}
              disabled={busy}
              title="Para pagos a maestros/proveedores que no emiten factura — crea el costo del proyecto sin documento."
              className="text-xs bg-white text-gray-900 px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              Pago sin factura…
            </button>
            <button
              onClick={marcarNetoCero}
              disabled={busy || !netoCeroElegible}
              title={
                netoCeroElegible
                  ? "Plata que entró y volvió (se cancelan entre sí). No cuenta como ingreso ni gasto."
                  : "Seleccioná entradas y salidas que se cancelen entre sí (neto = 0) y que no estén ya conciliadas."
              }
              className="text-xs bg-white text-gray-900 px-3 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
            >
              Devolución (neto cero)…
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
          // Si TODOS los movs seleccionados tienen la misma contraparte,
          // se la pasamos al modal para que filtre facturas por ese RUT
          // (caso tipico: 1 o N movs del mismo cliente).
          sharedCounterpartyRut={(() => {
            const ruts = selected
              .map((m) => (m.counterpartyRut ?? "").replace(/\D/g, ""))
              .filter((r) => r.length > 0);
            if (ruts.length === 0) return null;
            const unique = new Set(ruts);
            return unique.size === 1 ? ruts[0] : null;
          })()}
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onPick={asignar}
        />
      )}

      {sinFacturaOpen && (
        <PagoSinFacturaModal
          movementCount={selected.length}
          totalNeto={neto}
          busy={busy}
          projects={projects}
          categories={categories}
          onClose={() => setSinFacturaOpen(false)}
          onConfirm={pagoSinFactura}
        />
      )}
    </>
  );
}

// Modal para registrar los movimientos seleccionados como "pago sin
// factura": elige proyecto + categoría y se crea un registro de costo
// sin respaldo por cada movimiento (egreso).
function PagoSinFacturaModal({
  movementCount,
  totalNeto,
  busy,
  projects,
  categories,
  onClose,
  onConfirm,
}: {
  movementCount: number;
  totalNeto: number;
  busy: boolean;
  projects: { id: string; name: string }[];
  categories: { id: string; label: string }[];
  onClose: () => void;
  onConfirm: (projectId: string, categoryId: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");

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
              Pago sin factura
            </h2>
            <p className="text-xs text-gray-500 mt-1 tabular-nums">
              {movementCount} movimiento{movementCount !== 1 ? "s" : ""} · neto{" "}
              {formatCLP(totalNeto)}. Cada egreso se registra como un costo
              del proyecto, sin documento tributario.
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
              Proyecto
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            >
              <option value="">Elegí un proyecto…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs text-gray-600 px-3 py-2 hover:text-gray-900"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(projectId, categoryId)}
            disabled={busy || !projectId || !categoryId}
            className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? "Registrando…" : "Registrar pago sin factura"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal para elegir UNA factura emitida a la que imputar los movimientos
// seleccionados. Reusa /api/facturas/search restringido a emitidas.
function InvoicePickerModal({
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
  // Antes el modal hardcodeaba "emitida" y no permitía conciliar movs
  // negativos contra recibidas — caso reportado por MJ con "mantencion".
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
                            <div className="text-[9px] uppercase text-blue-700">
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
