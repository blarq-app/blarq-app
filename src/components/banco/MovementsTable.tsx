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
import PaymentsDetailPopover from "./PaymentsDetailPopover";
import ImputacionColumnFilter from "./ImputacionColumnFilter";
import ProyectoColumnFilter from "./ProyectoColumnFilter";
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
    // Obra imputada — solo se muestra en el desplegable de "N pagos".
    projectName: string | null;
    projectNumero: number | null;
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
  // Cuánto de este movimiento se neteó contra su devolución (el sobrante de un
  // pago de más). Cuenta como plata explicada, igual que las facturas.
  netZeroAmount: number | null;
  // Cuánto vuelve por este movimiento en notas de crédito (un mismo depósito
  // puede traer las NC de varias obras). También es plata explicada.
  ncRefundAmount: number;
  payments: Payment[];
};

// Cuánto del movimiento ya está explicado: facturas imputadas + sobrante
// neteado contra su devolución + notas de crédito que volvieron por acá. Es la
// misma cuenta que hace el servidor en saldadoDelMovimiento — si la pantalla
// mirara solo las facturas, un movimiento ya resuelto seguiría mostrando
// "libre $47.991" al lado.
function saldadoDeLaFila(m: MovementRow): number {
  return (
    m.payments.reduce((s, p) => s + p.amountApplied, 0) +
    (m.netZeroAmount ?? 0) +
    m.ncRefundAmount
  );
}

// Convierte una fila del listado al shape que consume el menú "Resolver".
function toMenuMovement(m: MovementRow): MenuMovement {
  return {
    id: m.id,
    amount: m.amount,
    status: m.status,
    hasPayments: m.payments.length > 0,
    // El menú necesita la parte libre real, así que las NC devueltas por este
    // movimiento viajan sumadas a lo neteado (para él son lo mismo: plata ya
    // explicada que no hay que volver a resolver).
    netZeroAmount: (m.netZeroAmount ?? 0) + m.ncRefundAmount || null,
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
  proyectosConTraspaso,
  proyectoFilterValue,
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
  // Obras con al menos un traspaso — opciones del filtro por obra de la
  // columna Respaldo. Vacío = no se muestra el filtro.
  proyectosConTraspaso: { id: string; name: string; numeroProyecto: number | null }[];
  proyectoFilterValue: string;
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
          <>
          {/* ── Celular: una tarjeta por movimiento ─────────────────────────
              La tabla mide 840px de mínimo; en un celular se veía hasta la
              Descripción y el MONTO quedaba fuera de pantalla. La tarjeta pone
              arriba glosa y monto, y deja abajo el respaldo y el botón
              "Resolver", que es lo que se hace desde acá. */}
          <div className="lg:hidden divide-y divide-gray-100">
            {selectableIds.length > 0 && (
              <label className="flex items-center gap-3 px-3 py-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-gray-900 w-4 h-4"
                />
                {selectedIds.size > 0
                  ? `${selectedIds.size} seleccionado${selectedIds.size === 1 ? "" : "s"}`
                  : "Seleccionar todos"}
              </label>
            )}
            {movements.map((m) => {
              const isCargo = m.amount < 0;
              const sumApplied = saldadoDeLaFila(m);
              const remaining = Math.max(0, Math.abs(m.amount) - sumApplied);
              const overImputed = sumApplied - Math.abs(m.amount) > 10;
              const isInternal = m.status === "interno";
              const isSelected = selectedIds.has(m.id);
              const est = deriveEstado(m.status);
              return (
                <div
                  key={m.id}
                  className={`px-3 py-3 ${isSelected ? "bg-gray-50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex items-center justify-center w-8 h-8 -ml-1.5 shrink-0">
                      {!isInternal && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(m.id)}
                          aria-label="Seleccionar movimiento"
                          className="accent-gray-900 w-4 h-4"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm text-gray-900 leading-snug">
                          {m.description}
                        </p>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-sm font-medium tabular-nums ${
                              isCargo ? "text-rose-700" : "text-emerald-700"
                            }`}
                          >
                            {formatCLP(m.amount)}
                          </div>
                          {m.status === "parcial" && (
                            <div className="text-[10px] text-gray-400">
                              libre {formatCLP(remaining)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-gray-500">
                        <span className="tabular-nums">
                          {new Date(m.date).toLocaleDateString("es-CL", {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                            timeZone: "UTC",
                          })}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="truncate max-w-[140px]">
                          {m.bankAccountAlias}
                        </span>
                        <span
                          className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${est.tone}`}
                        >
                          {est.label}
                        </span>
                      </div>
                      {m.counterpartyName && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {m.counterpartyName}
                        </p>
                      )}

                      <div className="mt-2 text-xs">
                        <RespaldoContenido
                          m={m}
                          isInternal={isInternal}
                          sumApplied={sumApplied}
                          overImputed={overImputed}
                          projects={projects}
                          imputacionCategories={imputacionCategories}
                          categoryLabels={categoryLabels}
                        />
                      </div>

                      <div className="mt-2 flex justify-end">
                        <MovementResolveMenu
                          movements={[toMenuMovement(m)]}
                          mode="row"
                          projects={projects}
                          categories={categories}
                          imputacionCategories={imputacionCategories}
                          blarqRutDigits={blarqRutDigits}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Escritorio: la tabla densa de siempre, sin cambios ────────── */}
          <div className="hidden lg:block overflow-x-auto">
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
                    {/* Dos filtros de columna: por obra (traspasos de tal
                        proyecto) y por tipo de imputación. La obra va primero
                        porque acota más — es "de qué obra", no "de qué tipo". */}
                    <ProyectoColumnFilter
                      value={proyectoFilterValue}
                      options={proyectosConTraspaso}
                    />
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
                  const sumApplied = saldadoDeLaFila(m);
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
                          // Las fechas de movimientos se guardan a medianoche UTC
                          // (día calendario de la cartola). Sin UTC, en Chile se
                          // verían un día menos.
                          timeZone: "UTC",
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
                        <RespaldoContenido
                          m={m}
                          isInternal={isInternal}
                          sumApplied={sumApplied}
                          overImputed={overImputed}
                          projects={projects}
                          imputacionCategories={imputacionCategories}
                          categoryLabels={categoryLabels}
                        />
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
          </>
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

/**
 * Contenido de la columna "Respaldo" (qué es el movimiento y con qué documento).
 *
 * Vive afuera de la tabla porque lo usan DOS vistas: la tabla del escritorio y
 * la tarjeta del celular. Antes estaba escrito inline dentro del <td>; si se
 * duplicaba para el celular, cualquier arreglo futuro habría que hacerlo en dos
 * lugares y tarde o temprano quedarían diciendo cosas distintas.
 */
function RespaldoContenido({
  m,
  isInternal,
  sumApplied,
  overImputed,
  projects,
  imputacionCategories,
  categoryLabels,
}: {
  m: MovementRow;
  isInternal: boolean;
  sumApplied: number;
  overImputed: boolean;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  imputacionCategories: { value: string; label: string }[];
  categoryLabels: Record<string, string>;
}) {
  return (
    <>
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
            {resp.linkeable ? (
              // Factura real y pago sin respaldo: la etiqueta
              // linkea al detalle de la factura. El pago sin
              // respaldo sigue sin mostrar su folio fantasma
              // SR-, pero al clickearlo se abre el pago y ahí
              // se ve a qué obra está imputado.
              <Link
                href={`/facturas?invoiceId=${m.payments[resp.indicePago].invoice.id}`}
                className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-200"
              >
                {resp.label}
              </Link>
            ) : (
              // Boleta / internacional: solo la etiqueta limpia.
              <span className="inline-block text-[9px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                {resp.label}
              </span>
            )}
            {/* Repartido entre varias facturas: el resumen
                se mantiene igual pero ahora se despliega y
                muestra la lista completa (folio · obra ·
                monto imputado), cada una linkeable. */}
            {m.payments.length > 1 && (
              <PaymentsDetailPopover
                payments={m.payments}
                sumApplied={sumApplied}
              />
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
              {categoryLabels[m.category] ?? m.category}
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
      </span>
    ) : (
      <span className="text-gray-300">—</span>
    )}
    </>
  );
}
