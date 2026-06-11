"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
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
};

const STATUS_TONE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  parcial: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-500",
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
    () => projects.map((p) => ({ id: p.id, name: p.name })),
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
      <div className="overflow-x-auto">
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
                  <Link
                    href={`/facturas/${inv.id}?from=${encodeURIComponent(returnTo)}`}
                    className="hover:text-gray-900 hover:underline"
                  >
                    {inv.folioNumber || "—"}
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
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      STATUS_TONE[inv.status] || "bg-gray-100"
                    }`}
                  >
                    {inv.status}
                  </span>
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
