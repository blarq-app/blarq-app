"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import MovementActionButton from "./MovementActionButton";
import MatchHintButton from "./MatchHintButton";
import MarkInternalButton from "./MarkInternalButton";
import MarkSinFacturaButton from "./MarkSinFacturaButton";
import UndoNetZeroButton from "./UndoNetZeroButton";
import MovementsBulkBar from "./MovementsBulkBar";

type Payment = {
  id: string;
  invoiceId: string;
  amountApplied: number;
  invoice: {
    id: string;
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
  };
};

export type MovementRow = {
  id: string;
  amount: number;
  date: string; // ISO
  description: string;
  counterpartyName: string | null;
  counterpartyRut: string | null;
  status: string;
  category: string | null;
  bankAccountAlias: string;
  payments: Payment[];
};

type MatchHint = { invoiceId: string; folio: string | null; remaining: number };

// Tabla client de /banco/movimientos. Maneja el estado de selección
// múltiple (checkbox por fila + "seleccionar todo") y monta la barra
// flotante de acciones masivas. El resto de la fila es idéntico a lo
// que antes renderizaba el server component.
export default function MovementsTable({
  movements,
  matchHints,
  statusLabels,
  categoryLabels,
  blarqRutDigits,
  projects,
  categories,
}: {
  movements: MovementRow[];
  matchHints: Record<string, MatchHint>;
  statusLabels: Record<string, { label: string; tone: string }>;
  categoryLabels: Record<string, string>;
  blarqRutDigits: string;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Movimientos seleccionables: todos menos los internos (no se imputan).
  const selectableIds = useMemo(
    () => movements.filter((m) => m.status !== "interno").map((m) => m.id),
    [movements]
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === selectableIds.length ? new Set() : new Set(selectableIds)
    );
  }

  const clear = () => setSelectedIds(new Set());

  // Datos que la barra necesita: monto, si tiene imputaciones, y el
  // RUT de la contraparte (para que el modal de "Asignar a factura"
  // priorice facturas del mismo cliente/proveedor).
  const selected = useMemo(
    () =>
      movements
        .filter((m) => selectedIds.has(m.id))
        .map((m) => ({
          id: m.id,
          amount: m.amount,
          hasPayments: m.payments.length > 0,
          counterpartyRut: m.counterpartyRut,
        })),
    [movements, selectedIds]
  );

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {movements.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">No hay movimientos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[840px]">
              <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectableIds.length === 0}
                      aria-label="Seleccionar todos"
                      className="accent-gray-900"
                    />
                  </th>
                  <th className="text-left px-4 py-2 w-24">Fecha</th>
                  <th className="text-left px-4 py-2 w-24">Cuenta</th>
                  <th className="text-left px-4 py-2">Descripción</th>
                  <th className="text-right px-4 py-2">Monto</th>
                  <th className="text-left px-4 py-2 w-32">Imputación</th>
                  <th className="text-left px-4 py-2 w-32">Estado</th>
                  <th className="px-4 py-2 w-44 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((m) => {
                  const isCargo = m.amount < 0;
                  const sumApplied = m.payments.reduce(
                    (s, p) => s + p.amountApplied,
                    0
                  );
                  const remaining = Math.max(
                    0,
                    Math.abs(m.amount) - sumApplied
                  );
                  // Sobreimputado: la suma de pagos supera el monto del
                  // movimiento (±$10 de tolerancia por redondeo de IVA). No
                  // debería pasar — la app lo impide al imputar — pero si queda
                  // dato viejo o se edita la base a mano, lo marcamos en rojo.
                  const overImputed = sumApplied - Math.abs(m.amount) > 10;
                  const isInternal = m.status === "interno";
                  const isSelected = selectedIds.has(m.id);
                  const hint = matchHints[m.id];
                  return (
                    <tr
                      key={m.id}
                      className={isSelected ? "bg-gray-50" : "hover:bg-gray-50"}
                    >
                      <td className="px-3 py-2">
                        {!isInternal && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(m.id)}
                            aria-label="Seleccionar movimiento"
                            className="accent-gray-900"
                          />
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 whitespace-nowrap tabular-nums">
                        {new Date(m.date).toLocaleDateString("es-CL", {
                          day: "2-digit",
                          month: "short",
                          year: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">
                        {m.bankAccountAlias}
                      </td>
                      <td className="px-4 py-2 text-gray-900 truncate max-w-[280px]">
                        {m.description}
                        {m.counterpartyName && (
                          <span className="text-xs text-gray-400 ml-2">
                            · {m.counterpartyName}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                          isCargo ? "text-rose-700" : "text-emerald-700"
                        }`}
                      >
                        {formatCLP(m.amount)}
                        {m.status === "parcial" && (
                          <div className="text-[10px] text-gray-400 font-normal">
                            libre {formatCLP(remaining)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {m.payments.length > 0 ? (
                          <div className="space-y-0.5">
                            {m.payments.slice(0, 2).map((p) => (
                              <Link
                                key={p.id}
                                // Va a la lista de facturas filtrada por el
                                // folio (no al formulario de edición): MJ
                                // prefiere ver la factura en la lista, con su
                                // estado y el botón de PDF. Si no hay folio,
                                // cae al detalle por id.
                                href={
                                  p.invoice.folioNumber
                                    ? `/facturas?q=${encodeURIComponent(p.invoice.folioNumber)}`
                                    : `/facturas/${p.invoice.id}`
                                }
                                className="block text-gray-700 hover:text-gray-900 hover:underline truncate"
                              >
                                F-{p.invoice.folioNumber} (
                                {formatCLP(p.amountApplied)})
                              </Link>
                            ))}
                            {m.payments.length > 2 && (
                              <span className="text-[10px] text-gray-400">
                                + {m.payments.length - 2} más
                              </span>
                            )}
                            {overImputed && (
                              <span
                                className="inline-block text-[9px] uppercase tracking-wide bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded"
                                title={`Este movimiento tiene ${formatCLP(sumApplied)} imputados, más que su monto de ${formatCLP(Math.abs(m.amount))}. Revisá las imputaciones.`}
                              >
                                ⚠ imputado de más {formatCLP(sumApplied - Math.abs(m.amount))}
                              </span>
                            )}
                          </div>
                        ) : m.category ? (
                          <span className="text-gray-600">
                            {categoryLabels[m.category] ?? m.category}
                          </span>
                        ) : isInternal ? (
                          <span className="text-gray-500">transfer interno</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-[9px] uppercase tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded ${
                            statusLabels[m.status]?.tone ?? "bg-gray-100"
                          }`}
                        >
                          {statusLabels[m.status]?.label ?? m.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {hint && (
                            <MatchHintButton
                              movimientoId={m.id}
                              invoiceId={hint.invoiceId}
                              folio={hint.folio}
                            />
                          )}
                          {(m.status === "sin_asignar" ||
                            m.status === "parcial") &&
                            (m.counterpartyRut ?? "")
                              .replace(/\D/g, "")
                              .includes(blarqRutDigits) && (
                              <MarkInternalButton movimientoId={m.id} />
                            )}
                          {(m.status === "sin_asignar" ||
                            m.status === "parcial") && (
                            <MarkSinFacturaButton movimientoId={m.id} />
                          )}
                          {m.status === "neto_cero" && (
                            <UndoNetZeroButton movimientoId={m.id} />
                          )}
                          <MovementActionButton
                            movimientoId={m.id}
                            amount={m.amount}
                            description={m.description}
                            counterpartyName={m.counterpartyName}
                            counterpartyRut={m.counterpartyRut}
                            date={m.date}
                            bankAccountAlias={m.bankAccountAlias}
                            existingPayments={m.payments.map((p) => ({
                              id: p.id,
                              invoiceId: p.invoiceId,
                              amountApplied: p.amountApplied,
                              invoice: {
                                folioNumber: p.invoice.folioNumber,
                                businessName: p.invoice.businessName,
                                totalAmount: p.invoice.totalAmount,
                              },
                            }))}
                            status={m.status}
                            variant={
                              m.status === "sin_asignar" ||
                              m.status === "parcial"
                                ? "primary"
                                : "ghost"
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MovementsBulkBar
        selected={selected}
        onClear={clear}
        projects={projects}
        categories={categories}
      />
    </>
  );
}
