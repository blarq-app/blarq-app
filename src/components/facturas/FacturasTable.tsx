"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import { invoiceStatusBadge } from "@/lib/facturas/statusBadge";
import BulkAssignBar from "./BulkAssignBar";
import {
  EditableCategoryCell,
  EditableProjectCell,
  type CategoryOption,
  type ProjectOption,
} from "./EditableInvoiceFields";

type Project = {
  id: string;
  name: string;
  numeroProyecto: number | null;
  numeroCotizacion: number | null;
};
type Category = {
  id: string;
  name: string;
  appliesTo?: string;
  parent: { id: string; name: string } | null;
};

type Invoice = {
  id: string;
  type: string;
  tipoDoc: number | null;
  folioNumber: string | null;
  issueDate: string;
  businessName: string | null;
  rutIssuer: string | null;
  totalAmount: number;
  status: string;
  origin: string;
  referenceFolioNumber: string | null;
  // id de la factura original que esta NC/ND referencia, ya resuelto en el
  // server (page.tsx) a partir de (type, folio referenciado, RUT). Si la
  // original no existe en la app, viene null y el "ref" queda como texto
  // plano no clickeable.
  referencedInvoiceId: string | null;
  // Indica si tenemos el PDF oficial del SII bajado (vía sync local).
  // Cuando está set, el endpoint /pdf sirve el PDF oficial; sino, el resumen.
  siiCodigo: string | null;
  project: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  // true = alguna imputación de esta factura la creó el auto-match. Marca
  // discreta en la UI para que MJ pueda revisar las conciliadas solas.
  autoMatched: boolean;
  // Saldo pendiente (total − pagado − créditos NC). 0 = saldada/pagada.
  remaining: number;
  // NC aplicadas a esta factura como crédito (id + folio + monto). Se muestran
  // como marca propia en la fila, independiente del estado. Vacío = sin NC.
  ncApplied: { id: string; folio: string | null; amount: number }[];
  // Modo de compensación si es una NC ya compensada (other_invoice /
  // cash_refund / bank_refund). null = NC sin compensar o no es NC. Hace que
  // una NC compensada muestre "compensada" en vez de "pagada".
  compensationType: string | null;
};

export default function FacturasTable({
  invoices,
  projects,
  categories,
}: {
  invoices: Invoice[];
  projects: Project[];
  categories: Category[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // URL de la lista con el filtro activo (ej. ?q=brune). Se la pasamos a la
  // pantalla de detalle como `from` para que el botón "Volver" devuelva a MJ
  // exactamente a donde estaba, con el filtro puesto.
  const sp = useSearchParams();
  const listSearch = sp.toString();
  const returnTo = listSearch ? `/facturas?${listSearch}` : "/facturas";

  // Adaptamos los props existentes al shape que esperan los selects inline.
  const projectOptions: ProjectOption[] = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        numeroProyecto: p.numeroProyecto,
        numeroCotizacion: p.numeroCotizacion,
      })),
    [projects]
  );
  const categoryOptions: CategoryOption[] = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parent?.id ?? null,
        parentName: c.parent?.name ?? null,
        appliesTo: c.appliesTo,
      })),
    [categories]
  );

  const allVisibleIds = useMemo(() => invoices.map((i) => i.id), [invoices]);
  const allSelected = selected.size > 0 && selected.size === allVisibleIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected || someSelected) setSelected(new Set());
    else setSelected(new Set(allVisibleIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* ── Celular: una tarjeta por factura ──────────────────────────────
          La tabla mide 800px de mínimo y en un celular de 390px se veía hasta
          la columna Fecha: el TOTAL, que es el dato por el que se entra a esta
          pantalla, quedaba fuera y había que arrastrar de costado para leerlo.
          La tarjeta pone arriba lo que identifica la factura (emisor y monto) y
          deja abajo lo que se edita (obra y categoría), que es lo que MJ hace
          acá cuando cataloga desde el teléfono. */}
      <div className="lg:hidden divide-y divide-gray-100 border-t border-gray-100">
        {/* El "seleccionar todas" vive en el <thead> de la tabla, que en el
            celular no se muestra. Sin esto no habría forma de hacer una
            asignación masiva desde el teléfono. */}
        {invoices.length > 0 && (
          <label className="flex items-center gap-3 px-1 py-2 text-xs text-gray-500 cursor-pointer">
            <span className="flex items-center justify-center w-9 h-9 -ml-1">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
              />
            </span>
            {selected.size > 0
              ? `${selected.size} seleccionada${selected.size === 1 ? "" : "s"}`
              : "Seleccionar todas"}
          </label>
        )}
        {invoices.map((inv) => {
          const isSelected = selected.has(inv.id);
          const badge = invoiceStatusBadge(inv.status, {
            isCompensatedNc: inv.tipoDoc === 61 && !!inv.compensationType,
          });
          return (
            <div
              key={inv.id}
              className={`px-1 py-3 ${isSelected ? "bg-blue-50" : ""}`}
            >
              <div className="flex items-start gap-3">
                <label className="flex items-center justify-center w-9 h-9 -ml-1 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(inv.id)}
                    aria-label={`Seleccionar factura ${inv.folioNumber}`}
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/facturas/${inv.id}?from=${encodeURIComponent(returnTo)}`}
                      className="min-w-0 text-sm font-medium text-gray-900 leading-snug hover:underline"
                    >
                      {inv.businessName || inv.rutIssuer || "—"}
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-gray-900 tabular-nums">
                        {formatCLP(inv.totalAmount)}
                      </div>
                      {inv.remaining > 0 ? (
                        <div
                          className={`text-[11px] tabular-nums ${
                            inv.status === "parcial"
                              ? "text-blue-700"
                              : "text-gray-500"
                          }`}
                        >
                          saldo {formatCLP(inv.remaining)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-gray-500">
                    <span className="tabular-nums">
                      {inv.tipoDoc === 1043
                        ? inv.origin === "gasto_boleta"
                          ? "boleta"
                          : inv.origin === "gasto_internacional"
                            ? "internacional"
                            : "pago s/factura"
                        : inv.folioNumber || "—"}
                    </span>
                    {inv.tipoDoc === 61 && (
                      <span className="text-[9px] uppercase tracking-wider bg-rose-50 text-rose-700 px-1 py-0.5 rounded">
                        NC
                      </span>
                    )}
                    {inv.tipoDoc === 56 && (
                      <span className="text-[9px] uppercase tracking-wider bg-amber-50 text-amber-700 px-1 py-0.5 rounded">
                        ND
                      </span>
                    )}
                    <span className="text-gray-300">·</span>
                    <span>{formatDate(inv.issueDate)}</span>
                    <span className="text-gray-300">·</span>
                    <span
                      className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.tone}`}
                    >
                      {badge.label}
                    </span>
                    {inv.origin === "sii_automatica" && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        SII
                      </span>
                    )}
                    {inv.autoMatched && (
                      <span
                        className="text-[9px] lowercase text-gray-400"
                        title="Conciliada automáticamente — revisá si tenés dudas"
                      >
                        auto
                      </span>
                    )}
                  </div>

                  {/* Referencias a otras facturas (NC/ND). Fuera del renglón de
                      arriba porque son links y necesitan alto propio. */}
                  {inv.referenceFolioNumber &&
                    (inv.referencedInvoiceId ? (
                      <Link
                        href={`/facturas/${inv.referencedInvoiceId}?from=${encodeURIComponent(returnTo)}`}
                        className="block text-[11px] text-gray-500 hover:text-gray-900 mt-1"
                      >
                        ↩ ref F-{inv.referenceFolioNumber}
                      </Link>
                    ) : (
                      <div className="text-[11px] text-gray-400 mt-1">
                        ↩ ref F-{inv.referenceFolioNumber}
                      </div>
                    ))}
                  {inv.ncApplied.map((nc) => (
                    <Link
                      key={nc.id}
                      href={`/facturas/${nc.id}?from=${encodeURIComponent(returnTo)}`}
                      className="block text-[11px] text-rose-600 mt-1"
                    >
                      ↳ NC F-{nc.folio} ({formatCLP(nc.amount)})
                    </Link>
                  ))}

                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="w-16 shrink-0 text-[11px] text-gray-400">
                        Obra
                      </span>
                      <div className="min-w-0 flex-1">
                        <EditableProjectCell
                          invoiceId={inv.id}
                          currentProjectId={inv.project?.id ?? null}
                          currentProjectName={inv.project?.name ?? null}
                          options={projectOptions}
                        />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="w-16 shrink-0 text-[11px] text-gray-400">
                        Categoría
                      </span>
                      <div className="min-w-0 flex-1">
                        <EditableCategoryCell
                          invoiceId={inv.id}
                          invoiceType={inv.type as "emitida" | "recibida"}
                          currentCategoryId={inv.category?.id ?? null}
                          currentCategoryName={inv.category?.name ?? null}
                          options={categoryOptions}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <a
                  href={`/api/facturas/${inv.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center w-9 h-9 shrink-0 ${
                    inv.siiCodigo
                      ? "text-green-600"
                      : "text-gray-400"
                  }`}
                  title={
                    inv.siiCodigo
                      ? "PDF oficial del SII"
                      : "PDF resumen interno (los oficiales se bajan vía sync local)"
                  }
                >
                  {inv.siiCodigo ? "↓✓" : "↓"}
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Escritorio: la tabla densa de siempre, sin cambios ───────────── */}
      <div className="hidden lg:block overflow-x-auto">
      <table className="w-full text-sm min-w-[800px]">
        <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
          <tr>
            <th className="px-3 py-2 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                className="cursor-pointer"
                aria-label="Seleccionar todas las visibles"
              />
            </th>
            <th className="text-left px-4 py-2">Tipo</th>
            <th className="text-left px-4 py-2">Folio</th>
            <th className="text-left px-4 py-2">Fecha</th>
            <th className="text-left px-4 py-2">Emisor</th>
            <th className="text-left px-4 py-2">Proyecto</th>
            <th className="text-left px-4 py-2">Categoría</th>
            <th className="text-right px-4 py-2">Total</th>
            <th className="text-right px-4 py-2">Saldo</th>
            <th className="text-left px-4 py-2">Estado</th>
            <th className="text-left px-4 py-2">Origen</th>
            <th className="text-right px-3 py-2">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((inv) => {
            const isSelected = selected.has(inv.id);
            return (
              <tr
                key={inv.id}
                className={isSelected ? "bg-blue-50" : "hover:bg-gray-50"}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(inv.id)}
                    className="cursor-pointer"
                    aria-label={`Seleccionar factura ${inv.folioNumber}`}
                  />
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded tracking-wider ${
                      inv.type === "emitida"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {inv.type}
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums text-gray-700">
                  {/* tipoDoc 1043 = pago sin documento tributario (registrado
                      desde un movimiento del banco). Su "folio" es un código
                      interno largo (SR-…) que no le dice nada a MJ y ensanchaba
                      la tabla. Mostramos una etiqueta amistosa; el código real
                      queda en el tooltip. El resto de los folios se trunca para
                      que ningún folio largo rompa el ancho. */}
                  <Link
                    href={`/facturas/${inv.id}?from=${encodeURIComponent(returnTo)}`}
                    title={inv.folioNumber ?? undefined}
                    className="inline-block max-w-[140px] truncate align-bottom hover:text-gray-900 hover:underline"
                  >
                    {inv.tipoDoc === 1043 ? (
                      <span className="text-gray-500 italic">
                        {inv.origin === "gasto_boleta"
                          ? "boleta"
                          : inv.origin === "gasto_internacional"
                            ? "internacional"
                            : "pago s/factura"}
                      </span>
                    ) : (
                      inv.folioNumber || "—"
                    )}
                  </Link>
                  {inv.tipoDoc === 61 && (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-rose-50 text-rose-700 px-1 py-0.5 rounded">
                      NC
                    </span>
                  )}
                  {inv.tipoDoc === 56 && (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-amber-50 text-amber-700 px-1 py-0.5 rounded">
                      ND
                    </span>
                  )}
                  {inv.referenceFolioNumber &&
                    (inv.referencedInvoiceId ? (
                      <Link
                        href={`/facturas/${inv.referencedInvoiceId}?from=${encodeURIComponent(returnTo)}`}
                        className="block text-[10px] text-gray-500 hover:text-gray-900 hover:underline mt-0.5"
                      >
                        ↩ ref F-{inv.referenceFolioNumber}
                      </Link>
                    ) : (
                      // La factura original no está cargada en la app: dejamos
                      // el texto plano, sin link a una página inexistente.
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        ↩ ref F-{inv.referenceFolioNumber}
                      </div>
                    ))}
                  {/* Marca de NC recibida: NC que aplicaron crédito a esta
                      factura. Independiente del estado (puede ser pagada o
                      anulada). Apunta a la ficha de la NC. */}
                  {inv.ncApplied.map((nc) => (
                    <Link
                      key={nc.id}
                      href={`/facturas/${nc.id}?from=${encodeURIComponent(returnTo)}`}
                      className="block text-[10px] text-rose-600 hover:text-rose-800 hover:underline mt-0.5"
                      title={`Esta factura recibió el crédito de la NC F-${nc.folio}`}
                    >
                      ↳ NC F-{nc.folio} ({formatCLP(nc.amount)})
                    </Link>
                  ))}
                </td>
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                  {formatDate(inv.issueDate)}
                </td>
                <td className="px-4 py-2 text-gray-700 truncate max-w-[200px]">
                  {inv.businessName || inv.rutIssuer || "—"}
                </td>
                <td className="px-4 py-2 max-w-[180px]">
                  <EditableProjectCell
                    invoiceId={inv.id}
                    currentProjectId={inv.project?.id ?? null}
                    currentProjectName={inv.project?.name ?? null}
                    options={projectOptions}
                  />
                </td>
                <td className="px-4 py-2 max-w-[180px]">
                  <EditableCategoryCell
                    invoiceId={inv.id}
                    invoiceType={inv.type as "emitida" | "recibida"}
                    currentCategoryId={inv.category?.id ?? null}
                    currentCategoryName={inv.category?.name ?? null}
                    options={categoryOptions}
                  />
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-900">
                  {formatCLP(inv.totalAmount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {inv.remaining > 0 ? (
                    <span
                      className={
                        inv.status === "parcial"
                          ? "text-blue-700"
                          : "text-gray-700"
                      }
                    >
                      {formatCLP(inv.remaining)}
                    </span>
                  ) : (
                    // "El cero no ocupa espacio prominente": saldada/pagada.
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {(() => {
                    const badge = invoiceStatusBadge(inv.status, {
                      isCompensatedNc: inv.tipoDoc === 61 && !!inv.compensationType,
                    });
                    return (
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.tone}`}
                      >
                        {badge.label}
                      </span>
                    );
                  })()}
                  {inv.autoMatched && (
                    <span
                      className="ml-1 text-[9px] lowercase tracking-wider text-gray-400"
                      title="Conciliada automáticamente — revisá si tenés dudas"
                    >
                      auto
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      inv.origin === "sii_automatica"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {inv.origin === "sii_automatica" ? "SII" : "manual"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={`/api/facturas/${inv.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-base ${
                      inv.siiCodigo
                        ? "text-green-600 hover:text-green-800"
                        : "text-gray-400 hover:text-gray-900"
                    }`}
                    title={
                      inv.siiCodigo
                        ? "PDF oficial del SII"
                        : "PDF resumen interno (los oficiales se bajan vía sync local)"
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    {inv.siiCodigo ? "↓✓" : "↓"}
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <BulkAssignBar
        selectedIds={Array.from(selected)}
        selectedTypes={
          new Set(
            invoices
              .filter((i) => selected.has(i.id))
              .map((i) => i.type as "emitida" | "recibida")
          )
        }
        onClear={() => setSelected(new Set())}
        projects={projects}
        categories={categories}
      />
    </>
  );
}
