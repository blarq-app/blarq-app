import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCLP, formatDate } from "@/lib/utils";
import ProjectFacturasFilters from "@/components/facturas/ProjectFacturasFilters";

type SearchParams = {
  type?: "emitida" | "recibida";
  status?: "pendiente" | "parcial" | "pagada" | "anulada";
  origin?: "manual" | "sii_automatica";
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
};

const STATUS_TONE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  parcial: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-500",
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
    // Match contra category.name (incluye top y subs)
    where.category = { is: { name: sp.category } };
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
      { folioNumber: { contains: sp.q } },
      { businessName: { contains: sp.q } },
      { rutIssuer: { contains: sp.q } },
      { notes: { contains: sp.q } },
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

  // Helper: cuánto está cobrado/pagado de una factura. Para facturas
  // pagadas via "marca manual" sin InvoicePayment, asumimos full.
  const paidOf = (
    inv: { status: string; totalAmount: number; payments: { amountApplied: number }[] }
  ) => {
    if (inv.payments.length > 0) return inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    return inv.status === "pagada" ? inv.totalAmount : 0;
  };
  const remainingOf = (
    inv: { status: string; totalAmount: number; payments: { amountApplied: number }[] }
  ) => Math.max(0, inv.totalAmount - paidOf(inv));

  // Lista global del proyecto (sin filtros) para tabs y para tener
  // contexto del "X de Y total" cuando hay filtros activos.
  const allInvoices = await prisma.invoice.findMany({
    where: { projectId: id },
    select: { id: true, type: true, category: { select: { name: true } } },
  });
  const totalProjectInvoices = allInvoices.length;
  const totalEmitidasProject = allInvoices.filter((i) => i.type === "emitida").length;
  const totalRecibidasProject = allInvoices.filter((i) => i.type === "recibida").length;

  // Categorías presentes en facturas de este proyecto, para el dropdown
  const categoriesInProject = Array.from(
    new Set(allInvoices.map((i) => i.category?.name).filter(Boolean) as string[])
  ).sort();

  // Stats arriba: usan las facturas FILTRADAS (sin filtro = todas).
  // Eso responde al pedido de MJ: ver totales del filtro aplicado.
  const totalEmitido = invoices
    .filter((i) => i.type === "emitida")
    .reduce((s, i) => s + i.totalAmount, 0);
  const totalRecibido = invoices
    .filter((i) => i.type === "recibida")
    .reduce((s, i) => s + i.totalAmount, 0);
  // "Por cobrar/pagar" = saldo restante (totalAmount − ya imputado). Cubre
  // tanto status=pendiente (saldo completo) como parcial (saldo residual).
  const porCobrar = invoices
    .filter((i) => i.type === "emitida" && i.status !== "pagada" && i.status !== "anulada")
    .reduce((s, i) => s + remainingOf(i), 0);
  const porPagar = invoices
    .filter((i) => i.type === "recibida" && i.status !== "pagada" && i.status !== "anulada")
    .reduce((s, i) => s + remainingOf(i), 0);

  const isFiltered =
    !!(sp.status || sp.origin || sp.category || sp.dateFrom || sp.dateTo || sp.q);

  return (
    <div>
      {/* Stats — reflejan el filtro aplicado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="Emitido" value={formatCLP(totalEmitido)} sub="cobros al cliente" />
        <Stat label="Recibido" value={formatCLP(totalRecibido)} sub="gastos a proveedores" />
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
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
                      href={`/facturas/${inv.id}`}
                      className="hover:text-gray-900 hover:underline"
                    >
                      {inv.folioNumber || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                    {formatDate(inv.issueDate)}
                  </td>
                  <td className="px-4 py-2 text-gray-700 truncate max-w-[240px]">
                    {inv.businessName || inv.rutIssuer || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {inv.category?.name ?? (
                      <span className="text-gray-400 italic">sin categoría</span>
                    )}
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
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        STATUS_TONE[inv.status] || "bg-gray-100"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        inv.origin === "sii_automatica"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {inv.origin === "sii_automatica" ? "SII" : "manual"}
                    </span>
                  </td>
                </tr>
              ))}
              {/* Fila de total al pie de la tabla */}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td colSpan={5} className="px-4 py-2 text-right text-xs uppercase tracking-wider text-gray-700">
                  Total mostrado · {invoices.length} factura{invoices.length !== 1 ? "s" : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatCLP(invoices.reduce((s, i) => s + i.totalAmount, 0))}
                </td>
                <td colSpan={2}></td>
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
