"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import MovementResolveMenu, { type MenuMovement } from "./MovementResolveMenu";
import MovementsSelectionBar from "./MovementsSelectionBar";
import InternalTransferProjectSelect from "./InternalTransferProjectSelect";
import InternalTransferConceptoSelect from "./InternalTransferConceptoSelect";
import SalaryPeriodSelect from "./SalaryPeriodSelect";
import CategoryInlineSelect from "./CategoryInlineSelect";
import ImputacionColumnFilter from "./ImputacionColumnFilter";
import SocioPrestamoSelect from "./SocioPrestamoSelect";
import {
  esSocio,
  esCategoriaFinanciamientoSocio,
  labelFinanciamientoSocio,
} from "@/lib/banco/socios";
import { deriveEstado, derivePaymentRespaldo } from "@/lib/banco/movementDisplay";

type Payment = {
  id: string;
  invoiceId: string;
  amountApplied: number;
  invoice: {
    id: string;
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
    // Distingue factura real (sii_automatica/manual) de pago sin respaldo /
    // boleta / internacional. Se usa para derivar la columna "Respaldo".
    origin: string | null;
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
  // Obra conciliada (solo se usa hoy para transferencias internas).
  projectId: string | null;
  // Concepto del traspaso (obra | muebles) — solo transferencias internas.
  internalConcepto: string | null;
  // A qué mes corresponde el pago (sueldo/previred), "YYYY-MM" o null (=auto).
  salaryPeriod: string | null;
  // A qué socio corresponde un préstamo/devolución cuando la plata fue a un
  // tercero por cuenta del socio. null = la contraparte ya dice quién es.
  socioRut: string | null;
  payments: Payment[];
};

// Convierte una fila del listado al shape que consume el menú "Resolver".
function toMenuMovement(m: MovementRow): MenuMovement {
  return {
    id: m.id,
    amount: m.amount,
    status: m.status,
    hasPayments: m.payments.length > 0,
    counterpartyRut: m.counterpartyRut,
    counterpartyName: m.counterpartyName,
    description: m.description,
    date: m.date,
    bankAccountAlias: m.bankAccountAlias,
    payments: m.payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountApplied: p.amountApplied,
      invoice: {
        folioNumber: p.invoice.folioNumber,
        businessName: p.invoice.businessName,
        totalAmount: p.invoice.totalAmount,
      },
    })),
  };
}

// Tabla client de /banco/movimientos. Maneja el estado de selección
// múltiple (checkbox por fila + "seleccionar todo") y monta el menú de
// acciones ("Resolver ▾") tanto por fila como para la selección. El resto
// de la fila es idéntico a lo que antes renderizaba el server component.
export default function MovementsTable({
  movements,
  categoryLabels,
  blarqRutDigits,
  projects,
  categories,
  imputacionCategories,
  showImputacionFilter,
  imputacionFilterValue,
}: {
  movements: MovementRow[];
  categoryLabels: Record<string, string>;
  blarqRutDigits: string;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
  // Categorías de imputación (para el editor inline y el filtro de columna).
  imputacionCategories: { value: string; label: string }[];
  // El filtro de la columna Imputación solo aparece en la cuenta "Sueldos".
  showImputacionFilter: boolean;
  imputacionFilterValue: string;
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

  // Movimientos seleccionados, en el shape que el menú "Resolver" necesita.
  const selected = useMemo(
    () =>
      movements
        .filter((m) => selectedIds.has(m.id))
        .map(toMenuMovement),
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
                  <th className="text-left px-4 py-2 w-28">Estado</th>
                  <th className="text-left px-4 py-2 w-72 align-top">
                    Respaldo
                    {showImputacionFilter && (
                      <ImputacionColumnFilter
                        value={imputacionFilterValue}
                        options={imputacionCategories}
                      />
                    )}
                  </th>
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
                      {/* ── ESTADO: solo resolución (Pendiente / Parcial /
                          Pagado). Derivado del status; ver movementDisplay.ts. */}
                      <td className="px-4 py-2">
                        {(() => {
                          const est = deriveEstado(m.status);
                          return (
                            <span
                              className={`text-[9px] uppercase tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded ${est.tone}`}
                            >
                              {est.label}
                            </span>
                          );
                        })()}
                      </td>
                      {/* ── RESPALDO: qué es / con qué documento. Reemplaza la
                          vieja columna "Imputación": el folio fantasma F-SR- de
                          los pagos sin respaldo se ESCONDE y en su lugar sale una
                          etiqueta limpia. Lo editable (categoría, mes, obra
                          interna) se mantiene. */}
                      <td className="px-4 py-2 text-xs">
                        {isInternal ? (
                          // Traspaso: etiqueta + selectores de obra/concepto (son
                          // los que atribuyen el traspaso a una obra — funcionan
                          // igual que antes).
                          <div className="space-y-1">
                            <span className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              Traspaso
                            </span>
                            <div className="flex items-center gap-1.5">
                              <InternalTransferProjectSelect
                                movimientoId={m.id}
                                projectId={m.projectId}
                                projects={projects}
                              />
                              <InternalTransferConceptoSelect
                                movimientoId={m.id}
                                concepto={m.internalConcepto}
                              />
                            </div>
                          </div>
                        ) : m.status === "neto_cero" ? (
                          <span className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            Devolución
                          </span>
                        ) : m.payments.length > 0 ? (
                          (() => {
                            const resp = derivePaymentRespaldo(
                              m.payments.map((p) => p.invoice.origin),
                              m.payments[0].invoice.folioNumber
                            );
                            return (
                              <div className="space-y-0.5">
                                {resp.esFacturaReal ? (
                                  // Factura real: la etiqueta linkea a la factura
                                  // (como antes se podía clickear el folio).
                                  <Link
                                    href={`/facturas?invoiceId=${m.payments[0].invoice.id}`}
                                    className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-200"
                                  >
                                    {resp.label}
                                  </Link>
                                ) : (
                                  // Pago sin respaldo / boleta / internacional: sin
                                  // folio fantasma, solo la etiqueta limpia.
                                  <span className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                    {resp.label}
                                  </span>
                                )}
                                {m.payments.length > 1 && (
                                  <span className="block text-[10px] text-gray-400 tabular-nums">
                                    {m.payments.length} pagos · {formatCLP(sumApplied)}
                                  </span>
                                )}
                                {overImputed && (
                                  <span
                                    className="inline-block text-[9px] uppercase tracking-wide bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded"
                                    title={`Este movimiento tiene ${formatCLP(sumApplied)} imputados, más que su monto de ${formatCLP(Math.abs(m.amount))}. Revisá las imputaciones.`}
                                  >
                                    imputado de más {formatCLP(sumApplied - Math.abs(m.amount))}
                                  </span>
                                )}
                              </div>
                            );
                          })()
                        ) : m.category ? (
                          <span className="text-gray-600">
                            {/* Gasto propio sin factura: la categoría se corrige
                                inline (ej. "Sueldo" → "Préstamo socio"). En
                                sin_asignar ("a confirmar") se deja el texto. */}
                            {m.status === "sin_factura" ? (
                              <CategoryInlineSelect
                                movimientoId={m.id}
                                category={m.category}
                                options={imputacionCategories}
                                enableGastoEmpresa={m.amount < 0}
                              />
                            ) : (
                              <>
                                <span className="uppercase tracking-wide">
                                  {/* Financiamiento con socios: el rótulo es
                                      direccional (una salida = "Devolución a
                                      socio", no "Préstamo") según el signo. */}
                                  {labelFinanciamientoSocio(m.category, m.amount) ??
                                    categoryLabels[m.category] ??
                                    m.category}
                                </span>
                                {m.status === "sin_asignar" && (
                                  <span className="ml-1 text-[9px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1 py-0.5 rounded align-middle whitespace-nowrap">
                                    a confirmar
                                  </span>
                                )}
                              </>
                            )}
                            {(m.category === "sueldo" || m.category === "previred") && (
                              <span className="mt-1 block">
                                <SalaryPeriodSelect
                                  movimientoId={m.id}
                                  category={m.category}
                                  date={m.date}
                                  salaryPeriod={m.salaryPeriod}
                                />
                              </span>
                            )}
                            {/* Préstamo/devolución cuya plata fue a un TERCERO:
                                el banco no sabe de qué socio es la deuda, así
                                que lo pedimos. Si va derecho a MJ/JT no se
                                muestra — la contraparte ya lo dice. */}
                            {esCategoriaFinanciamientoSocio(m.category) &&
                              !esSocio(m.counterpartyRut, m.counterpartyName, m.description) && (
                                <span className="mt-1 block">
                                  <SocioPrestamoSelect
                                    movimientoId={m.id}
                                    socioRut={m.socioRut}
                                  />
                                </span>
                              )}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end">
                          <MovementResolveMenu
                            movements={[toMenuMovement(m)]}
                            mode="row"
                            projects={projects}
                            categories={categories}
                            imputacionCategories={imputacionCategories}
                            blarqRutDigits={blarqRutDigits}
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

      <MovementsSelectionBar
        movements={selected}
        onClear={clear}
        projects={projects}
        categories={categories}
        imputacionCategories={imputacionCategories}
        blarqRutDigits={blarqRutDigits}
      />
    </>
  );
}
