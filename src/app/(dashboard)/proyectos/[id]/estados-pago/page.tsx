import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import Link from "next/link";
import NuevoEPButton from "@/components/estadosPago/NuevoEPButton";

export default async function EstadosPagoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      maestro: true,
      estadosPago: {
        orderBy: { number: "desc" },
        include: { items: true },
      },
      budgetVersions: {
        where: { type: "obra" },
        include: { obraItems: true },
      },
    },
  });

  if (!project) notFound();

  // Monto a pagar por EP = Σ items.laborTotal * pctAcum/100  -  mismo acumulado del EP anterior
  const sorted = [...project.estadosPago].sort((a, b) => a.number - b.number);
  const epAcum = sorted.map((ep) =>
    ep.items.reduce(
      (sum, it) => sum + (it.laborTotal * it.pctAccumulated) / 100,
      0
    )
  );
  const epThis = epAcum.map((t, i) => t - (i > 0 ? epAcum[i - 1] : 0));
  const amountById = new Map<string, number>();
  sorted.forEach((ep, i) => amountById.set(ep.id, epThis[i]));

  const hasObra = project.budgetVersions.some((b) => b.obraItems.length > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link
            href={`/proyectos/${project.id}`}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            {project.name}
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-2xl font-bold text-gray-900">Estados de Pago</h1>
        </div>
        <NuevoEPButton projectId={project.id} disabled={!hasObra} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Maestro asignado</p>
            <p className="text-lg font-medium text-gray-900 mt-0.5">
              {project.maestro?.name || "— Sin asignar —"}
            </p>
            {project.maestro?.phone && (
              <p className="text-sm text-gray-500 mt-0.5">
                {project.maestro.phone}
                {project.maestro.emitsInvoice && " · emite factura"}
              </p>
            )}
          </div>
          <Link
            href={`/proyectos/${project.id}/editar`}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Cambiar
          </Link>
        </div>
      </div>

      {!hasObra && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-4 text-sm">
          Para crear estados de pago primero tienes que tener un presupuesto de
          obra con partidas.
        </div>
      )}

      {project.estadosPago.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">
            Aún no hay estados de pago emitidos para este proyecto.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  EP N°
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Fecha
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Estado
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  A pagar
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {project.estadosPago.map((ep) => (
                <tr key={ep.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    EP #{ep.number}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(ep.date)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                      {ep.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCLP(amountById.get(ep.id) || 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/proyectos/${project.id}/estados-pago/${ep.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Abrir
                    </Link>
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
