import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import Link from "next/link";
import NuevaFacturaButton from "@/components/costos/NuevaFacturaButton";

export default async function FacturacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      invoices: {
        where: { type: "emitida" },
        orderBy: { issueDate: "desc" },
      },
      budgetVersions: {
        where: { status: "aprobado" },
        include: {
          paymentTerms: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!project) notFound();

  const totalEmitido = project.invoices.reduce(
    (sum, i) => sum + i.totalAmount,
    0
  );
  const totalPagado = project.invoices
    .filter((i) => i.status === "pagada")
    .reduce((sum, i) => sum + i.totalAmount, 0);
  const totalPendiente = project.invoices
    .filter((i) => i.status === "pendiente")
    .reduce((sum, i) => sum + i.totalAmount, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/proyectos/${project.id}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {project.name}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Facturacion</h1>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Emitido</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {formatCLP(totalEmitido)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Pagado</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {formatCLP(totalPagado)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Por Cobrar</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">
            {formatCLP(totalPendiente)}
          </p>
        </div>
      </div>

      {/* Lista de facturas emitidas */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Facturas Emitidas ({project.invoices.length})
        </h2>
        <NuevaFacturaButton
          projectId={project.id}
          type="emitida"
          categories={[]}
        />
      </div>

      {project.invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay facturas emitidas
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Fecha
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Folio
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Descripcion
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Neto
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  IVA
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Total
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {project.invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(invoice.issueDate)}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">
                    {invoice.folioNumber || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {invoice.notes || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {formatCLP(invoice.netAmount)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {formatCLP(invoice.iva)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCLP(invoice.totalAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        invoice.status === "pagada"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {invoice.status === "pagada" ? "Pagada" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
