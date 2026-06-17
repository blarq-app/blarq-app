import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCLP, formatDate } from "@/lib/utils";
import ProjectFacturasFilters from "@/components/facturas/ProjectFacturasFilters";
import ClickableInvoiceRow from "@/components/facturas/ClickableInvoiceRow";
import { invoiceStatusBadge } from "@/lib/facturas/statusBadge";
import {
  EditableCategoryCell,
  MoveProjectButton,
  type CategoryOption,
  type ProjectOption,
} from "@/components/facturas/EditableInvoiceFields";

type SearchParams = {
  type?: "emitida" | "recibida";
  status?: "pendiente" | "parcial" | "pagada" | "anulada";
  origin?: "manual" | "sii_automatica";
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
};

export default async function ProyectoFacturasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Construir el WHERE Prisma desde los searchParams.
  const where: Record<string, unknown> = { projectId: id };
  if (sp.type) where.type = sp.type;
  if (sp.status) where.status = sp.status;
  if (sp.origin) where.origin = sp.origin;
  if (sp.category) {
    if (sp.category === "__sin__") {
      // Sentinela: facturas sin categoría asignada (para que MJ las cataloge).
      where.categoryId = null;
    } else {
      // Match contra el nombre — si es una categoría padre (ej. "Artefactos"),
      // incluir también sus subcategorías ("Baño", "Cocina", "Iluminación").
      where.category = {
        is: {
          OR: [
            { name: sp.category },
            { parent: { is: { name: sp.category } } },
          ],
        },
      };
    }
  }
  if (sp.dateFrom || sp.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (sp.dateFrom) dateFilter.gte = new Date(sp.dateFrom);
    if (sp.dateTo) {
      // Inclusivo: hasta el final del día
      const end = new Date(sp.dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.issueDate = dateFilter;
  }
  if (sp.q) {
    where.OR = [
      { folioNumber: { contains: sp.q, mode: "insensitive" } },
      { businessName: { contains: sp.q, mode: "insensitive" } },
      { rutIssuer: { contains: sp.q, mode: "insensitive" } },
      { notes: { contains: sp.q, mode: "insensitive" } },
    ];
  }

  // Facturas filtradas (las que se muestran en la tabla)
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: "desc" },
    include: {
      category: { select: { id: true, name: true } },
      payments: { select: { amountApplied: true } },
    },
  });

  // NCs aplicadas como compensación a alguna de estas facturas (caso DP):
  //   NC.compensationType = "other_invoice"  +  NC.appliedToInvoiceId = ID
  // de la factura que esta NC está cubriendo. Sumamos su totalAmount al
  // "pagado" de la factura cubierta para que aparezca como pagada cuando
  // NC + InvoicePayments cubren el total.
  const invoiceIds = invoices.map((i) => i.id);
  const ncsCompensadas =
    invoiceIds.length > 0
      ? await prisma.invoice.findMany({
          where: {
            compensationType: "other_invoice",
            appliedToInvoiceId: { in: invoiceIds },
          },
          select: {
            id: true,
            appliedToInvoiceId: true,
            totalAmount: true,
            folioNumber: true,
          },
        })
      : [];
  const ncCreditByInvoice = new Map<string, number>();
  // Detalle de NC aplicadas a cada factura (id + folio + monto) → marca propia
  // en la fila, independiente del estado.
  const ncAppliedByInvoice = new Map<
    string,
    { id: string; folio: string | null; amount: number }[]
  >();
  for (const nc of ncsCompensadas) {
    if (!nc.appliedToInvoiceId) continue;
    // NC tiene totalAmount como número positivo en BD (Math.abs en import).
    // Acá la usamos como crédito → suma al "pagado" de la factura.
    ncCreditByInvoice.set(
      nc.appliedToInvoiceId,
      (ncCreditByInvoice.get(nc.appliedToInvoiceId) ?? 0) + Math.abs(nc.totalAmount)
    );
    const list = ncAppliedByInvoice.get(nc.appliedToInvoiceId) ?? [];
    list.push({ id: nc.id, folio: nc.folioNumber, amount: Math.abs(nc.totalAmount) });
    ncAppliedByInvoice.set(nc.appliedToInvoiceId, list);
  }

  // Helper: cuánto está cobrado/pagado de una factura. Para facturas
  // pagadas via "marca manual" sin InvoicePayment, asumimos full.
  // Suma además los créditos de NCs aplicadas a esta factura (caso DP).
  const paidOf = (
    inv: { id: string; status: string; totalAmount: number; payments: { amountApplied: number }[] }
  ) => {
    const ncCredit = ncCreditByInvoice.get(inv.id) ?? 0;
    if (inv.payments.length > 0) {
      return inv.payments.reduce((s, p) => s + p.amountApplied, 0) + ncCredit;
    }
    if (inv.status === "pagada") return inv.totalAmount;
    return ncCredit;
  };
  const remainingOf = (
    inv: { id: string; status: string; totalAmount: number; payments: { amountApplied: number }[] }
  ) => Math.max(0, inv.totalAmount - paidOf(inv));

  // Lista global del proyecto (sin filtros) para tabs y para tener
  // contexto del "X de Y total" cuando hay filtros activos.
  const allInvoices = await prisma.invoice.findMany({
    where: { projectId: id },
    select: {
      id: true,
      type: true,
      category: {
        select: {
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  });
  const totalProjectInvoices = allInvoices.length;
  const totalEmitidasProject = allInvoices.filter((i) => i.type === "emitida").length;
  const totalRecibidasProject = allInvoices.filter((i) => i.type === "recibida").length;

  // Categorías presentes en facturas de este proyecto, para el dropdown.
  // Incluye también la categoría padre cuando hay subs presentes (ej.
  // si hay facturas en "Baño" e "Iluminación", agregamos "Artefactos"
  // como opción de filtro que incluye a ambas).
  const catSet = new Set<string>();
  for (const inv of allInvoices) {
    if (inv.category?.name) catSet.add(inv.category.name);
    if (inv.category?.parent?.name) catSet.add(inv.category.parent.name);
  }
  const categoriesInProject = Array.from(catSet).sort();

  // Lista completa de categorías + proyectos para los selects inline.
  // Se cargan acá una vez y se pasan como prop a cada fila — más barato
  // que hacer fetch desde el cliente cada vez que MJ abre un dropdown.
  const allCategoriesRaw = await prisma.costCategory.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      appliesTo: true,
      parent: { select: { name: true } },
    },
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
  });
  const categoryOptions: CategoryOption[] = allCategoriesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    appliesTo: c.appliesTo,
  }));
  const allProjects = await prisma.project.findMany({
    // Solo proyectos asignables al reasignar una factura: se esconden las
    // cotizaciones no ganadas (status="cotizacion"). Internos (BLARQ) se
    // mantienen siempre.
    where: { NOT: { status: "cotizacion", isInternal: false } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const projectOptions: ProjectOption[] = allProjects;

  // Stats arriba: usan las facturas FILTRADAS (sin filtro = todas).
  // Eso responde al pedido de MJ: ver totales del filtro aplicado.
  // Una nota de crédito (DTE 61) revierte la factura — debe restar, no sumar.
  // Mismo helper que metrics.ts línea 147.
  const sign = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  const totalEmitido = invoices
    .filter((i) => i.type === "emitida")
    .reduce((s, i) => s + sign(i) * i.totalAmount, 0);
  const totalEmitidoNeto = invoices
    .filter((i) => i.type === "emitida")
    .reduce((s, i) => s + sign(i) * i.netAmount, 0);
  const totalRecibido = invoices
    .filter((i) => i.type === "recibida")
    .reduce((s, i) => s + sign(i) * i.totalAmount, 0);
  // Versión NETA del recibido — para cuadrar con el "real" del Resumen,
  // que está en neto porque el IVA se recupera como crédito fiscal.
  const totalRecibidoNeto = invoices
    .filter((i) => i.type === "recibida")
    .reduce((s, i) => s + sign(i) * i.netAmount, 0);
  // "Por cobrar/pagar" = saldo restante (totalAmount − ya imputado). Cubre
  // tanto status=pendiente (saldo completo) como parcial (saldo residual).
  // Las NCs también revierten saldo pendiente.
  const porCobrar = invoices
    .filter((i) => i.type === "emitida" && i.status !== "pagada" && i.status !== "anulada")
    .reduce((s, i) => s + sign(i) * remainingOf(i), 0);
  const porPagar = invoices
    .filter((i) => i.type === "recibida" && i.status !== "pagada" && i.status !== "anulada")
    .reduce((s, i) => s + sign(i) * remainingOf(i), 0);

  const isFiltered =
    !!(sp.status || sp.origin || sp.category || sp.dateFrom || sp.dateTo || sp.q);

  // URL actual de esta lista (con los filtros puestos) — viaja como ?from=
  // al detalle de la factura, para que el "Volver" devuelva a MJ a esta
  // pestaña del proyecto y no a la lista global de /facturas.
  const listParams = new URLSearchParams();
  if (sp.type) listParams.set("type", sp.type);
  if (sp.status) listParams.set("status", sp.status);
  if (sp.origin) listParams.set("origin", sp.origin);
  if (sp.category) listParams.set("category", sp.category);
  if (sp.dateFrom) listParams.set("dateFrom", sp.dateFrom);
  if (sp.dateTo) listParams.set("dateTo", sp.dateTo);
  if (sp.q) listParams.set("q", sp.q);
  const returnTo = `/proyectos/${project.id}/facturas${
    listParams.toString() ? "?" + listParams.toString() : ""
  }`;

  return (
    <div>
      {/* Stats — reflejan el filtro aplicado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat
          label="Emitido"
          value={formatCLP(totalEmitido)}
          sub={`neto ${formatCLP(totalEmitidoNeto)}`}
        />
        <Stat
          label="Recibido"
          value={formatCLP(totalRecibido)}
          sub={`neto ${formatCLP(totalRecibidoNeto)} · gastos a proveedores`}
        />
        <Stat
          label="Por cobrar"
          value={formatCLP(porCobrar)}
          sub="pendiente del cliente"
          tone="text-blue-600"
        />
        <Stat
          label="Por pagar"
          value={formatCLP(porPagar)}
          sub="pendiente a proveedores"
          tone="text-red-600"
        />
      </div>
      {isFiltered && (
        <p className="text-xs text-gray-500 mb-3 italic">
          Totales arriba calculados sobre {invoices.length} factura
          {invoices.length !== 1 ? "s" : ""} filtrada
          {invoices.length !== 1 ? "s" : ""} (de {totalProjectInvoices} totales).
        </p>
      )}

      {/* Tabs por tipo + acciones */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <TabLink projectId={project.id} sp={sp} type={undefined} label="Todas" count={totalProjectInvoices} />
          <TabLink
            projectId={project.id}
            sp={sp}
            type="emitida"
            label="Emitidas"
            count={totalEmitidasProject}
          />
          <TabLink
            projectId={project.id}
            sp={sp}
            type="recibida"
            label="Recibidas"
            count={totalRecibidasProject}
          />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/facturas?projectId=${project.id}`}
            className="text-xs text-gray-500 hover:text-gray-900 underline"
          >
            Vista global
          </Link>
          <Link
            href={`/facturas/nueva?projectId=${project.id}`}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            + Nueva factura
          </Link>
        </div>
      </div>

      {/* Fila de filtros tipo Excel */}
      <ProjectFacturasFilters
        basePath={`/proyectos/${project.id}/facturas`}
        categories={categoriesInProject}
        initial={{
          q: sp.q ?? "",
          status: sp.status ?? "",
          origin: sp.origin ?? "",
          category: sp.category ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
        }}
      />

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {invoices.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">
              {isFiltered
                ? "No hay facturas que coincidan con los filtros."
                : "No hay facturas para este proyecto."}
            </p>
            <Link
              href={`/facturas/nueva?projectId=${project.id}`}
              className="inline-block mt-3 text-sm text-gray-900 underline"
            >
              Cargar la primera factura
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Folio</th>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Emisor / Cliente</th>
                <th className="text-left px-4 py-2">Categoría</th>
                <th className="text-right px-4 py-2">Total <span className="block text-[9px] text-gray-400 normal-case font-normal">c/IVA</span></th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-left px-4 py-2">Origen</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <ClickableInvoiceRow
                  key={inv.id}
                  href={`/facturas/${inv.id}?from=${encodeURIComponent(returnTo)}`}
                >
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
                      {inv.origin === "maxxa_sin_respaldo"
                        ? <span className="not-tabular text-[11px] font-normal text-gray-700">Mov sin respaldo</span>
                        : (inv.folioNumber || "—")}
                    </Link>
                    {inv.origin === "maxxa_sin_respaldo" && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-gray-100 text-gray-600 px-1 py-0.5 rounded">
                        sin IVA
                      </span>
                    )}
                    {inv.tipoDoc === 61 && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-rose-50 text-rose-700 px-1 py-0.5 rounded">
                        NC
                      </span>
                    )}
                    {inv.compensationType === "cash_refund" && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-green-50 text-green-700 px-1 py-0.5 rounded">
                        $$ efectivo
                      </span>
                    )}
                    {inv.compensationType === "other_invoice" && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-blue-50 text-blue-700 px-1 py-0.5 rounded">
                        compensada
                      </span>
                    )}
                    {inv.tipoDoc === 56 && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-amber-50 text-amber-700 px-1 py-0.5 rounded">
                        ND
                      </span>
                    )}
                    {inv.referenceFolioNumber && (
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        ↩ ref F-{inv.referenceFolioNumber}
                      </div>
                    )}
                    {/* Marca de NC recibida: NC que aplicaron crédito a esta
                        factura. Independiente del estado. */}
                    {(ncAppliedByInvoice.get(inv.id) ?? []).map((nc) => (
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
                  <td className="px-4 py-2 text-gray-700 max-w-[240px]">
                    <div className="truncate">{inv.businessName || inv.rutIssuer || "—"}</div>
                    <MoveProjectButton
                      invoiceId={inv.id}
                      currentProjectId={project.id}
                      options={projectOptions}
                    />
                  </td>
                  <td className="px-4 py-2">
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
                    {inv.status === "parcial" && (
                      <div className="text-[10px] text-blue-700 font-normal mt-0.5">
                        {formatCLP(paidOf(inv))} cobrado · {formatCLP(remainingOf(inv))} falta
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {(() => {
                      const badge = invoiceStatusBadge(inv.status, {
                        isCompensatedNc:
                          inv.tipoDoc === 61 && !!inv.compensationType,
                      });
                      return (
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                      );
                    })()}
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
                  {/* Flechita que indica que la fila se abre. Gris tenue, se
                      oscurece al pasar el mouse por la fila (group-hover). Es
                      texto (›) porque el proyecto no usa lucide-react. */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-base leading-none text-gray-300 group-hover:text-gray-600">›</span>
                  </td>
                </ClickableInvoiceRow>
              ))}
              {/* Fila de total al pie de la tabla */}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td colSpan={5} className="px-4 py-2 text-right text-xs uppercase tracking-wider text-gray-700">
                  Total mostrado · {invoices.length} factura{invoices.length !== 1 ? "s" : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatCLP(invoices.reduce((s, i) => s + sign(i) * i.totalAmount, 0))}
                </td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TabLink({
  projectId,
  sp,
  type,
  label,
  count,
}: {
  projectId: string;
  sp: SearchParams;
  type?: "emitida" | "recibida";
  label: string;
  count: number;
}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (sp.status) params.set("status", sp.status);
  if (sp.origin) params.set("origin", sp.origin);
  if (sp.category) params.set("category", sp.category);
  if (sp.dateFrom) params.set("dateFrom", sp.dateFrom);
  if (sp.dateTo) params.set("dateTo", sp.dateTo);
  if (sp.q) params.set("q", sp.q);
  const href = `/proyectos/${projectId}/facturas${params.toString() ? "?" + params.toString() : ""}`;
  const isActive = sp.type === type;
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        isActive
          ? "bg-gray-900 text-white"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label} <span className="opacity-60">({count})</span>
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${tone ?? "text-gray-900"}`}>
        {value}
      </p>
      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
