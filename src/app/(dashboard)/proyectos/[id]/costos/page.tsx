import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import Link from "next/link";
import NuevaFacturaButton from "@/components/costos/NuevaFacturaButton";

export default async function CostosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      invoices: {
        where: { type: "recibida" },
        orderBy: { issueDate: "desc" },
        include: { category: true },
      },
    },
  });

  if (!project) notFound();

  const categories = await prisma.costCategory.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { sortOrder: "asc" },
  });

  // Agrupar gastos por categoría
  const gastosPorCategoria = categories.map((cat) => {
    const categoryIds = [cat.id, ...cat.children.map((c) => c.id)];
    const facturas = project.invoices.filter(
      (i) => i.categoryId && categoryIds.includes(i.categoryId)
    );
    const total = facturas.reduce((sum, i) => sum + i.totalAmount, 0);
    return { ...cat, facturas, total };
  });

  const totalGastos = project.invoices.reduce(
    (sum, i) => sum + i.totalAmount,
    0
  );
  const sinCategoria = project.invoices.filter((i) => !i.categoryId);

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
        <h1 className="text-2xl font-bold text-gray-900">Control de Costos</h1>
      </div>

      {/* Resumen por categoría */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Gastos por Categoria
        </h2>
        <div className="space-y-2">
          {gastosPorCategoria
            .filter((c) => c.total > 0)
            .map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between py-2 border-b border-gray-50"
              >
                <span className="text-sm text-gray-700">{cat.name}</span>
                <span className="text-sm font-medium text-gray-900">
                  {formatCLP(cat.total)}
                </span>
              </div>
            ))}
          {sinCategoria.length > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-gray-50">
              <span className="text-sm text-gray-500 italic">Sin categoria</span>
              <span className="text-sm font-medium text-gray-900">
                {formatCLP(
                  sinCategoria.reduce((sum, i) => sum + i.totalAmount, 0)
                )}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between py-2 font-bold">
            <span>Total Gastos</span>
            <span>{formatCLP(totalGastos)}</span>
          </div>
        </div>
      </div>

      {/* Lista de facturas recibidas */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Facturas Recibidas ({project.invoices.length})
        </h2>
        <NuevaFacturaButton
          projectId={project.id}
          type="recibida"
          categories={categories.flatMap((c) => [
            { id: c.id, name: c.name },
            ...c.children.map((ch) => ({
              id: ch.id,
              name: `  ${c.name} > ${ch.name}`,
            })),
          ])}
        />
      </div>

      {project.invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay facturas de costo registradas
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
                  Proveedor
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Folio
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Categoria
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Neto
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
                  <td className="px-4 py-3 text-gray-900">
                    {invoice.businessName || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {invoice.folioNumber || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {invoice.category?.name || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {formatCLP(invoice.netAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCLP(invoice.totalAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        invoice.status === "pagada"
                          ? "bg-green-100 text-green-800"
                          : invoice.status === "anulada"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {invoice.status === "pagada"
                        ? "Pagada"
                        : invoice.status === "anulada"
                        ? "Anulada"
                        : "Pendiente"}
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
