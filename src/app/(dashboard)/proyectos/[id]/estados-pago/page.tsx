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

  // Resumen cuenta maestro
  // MO presupuestada = viene del presupuesto aprobado (o el más reciente de obra)
  const obraBudget =
    project.budgetVersions.find((b) => b.status === "aprobado") ||
    project.budgetVersions[project.budgetVersions.length - 1];
  const moPresupuestada = obraBudget
    ? obraBudget.obraItems.reduce(
        (sum, it) => sum + (it.costLabor ?? 0) * it.quantity,
        0
      )
    : 0;
  // Total pagado = suma de montos de EPs con status "pagado"
  const totalPagado = sorted
    .filter((ep) => ep.status === "pagado")
    .reduce((sum, ep) => sum + (amountById.get(ep.id) || 0), 0);
  const saldoPendiente = moPresupuestada - totalPagado;
  const epsPagados = sorted.filter((ep) => ep.status === "pagado").length;

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <NuevoEPButton projectId={project.id} disabled={!hasObra} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
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

      {/* Resumen cuenta maestro */}
      {moPresupuestada > 0 && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Cuenta del Maestro</h3>
            {obraBudget && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                obraBudget.status === "aprobado"
                  ? "bg-green-100 text-green-700"
                  : "bg-yellow-100 text-yellow-700"
              }`}>
                {obraBudget.status === "aprobado" ? "✓" : "⚠"} {obraBudget.version}
                {obraBudget.status !== "aprobado" && " · no aprobado"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">MO Presupuestada</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {formatCLP(moPresupuestada)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                Total Pagado
                {epsPagados > 0 && (
                  <span className="ml-1 text-gray-400">({epsPagados} EP{epsPagados !== 1 ? "s" : ""})</span>
                )}
              </p>
              <p className="text-lg font-bold text-green-700 mt-0.5">
                {formatCLP(totalPagado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Saldo por Pagar</p>
              <p className={`text-lg font-bold mt-0.5 ${saldoPendiente > 0 ? "text-orange-600" : "text-gray-400"}`}>
                {formatCLP(Math.max(0, saldoPendiente))}
              </p>
            </div>
          </div>
          {moPresupuestada > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Avance de pago</span>
                <span>{Math.round((totalPagado / moPresupuestada) * 100)}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.round((totalPagado / moPresupuestada) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

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
