import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { BUDGET_STATUSES, BudgetStatus, formatDate } from "@/lib/utils";
import Link from "next/link";
import NuevaVersionButton from "@/components/presupuesto/NuevaVersionButton";
import AprobarBudgetButton from "@/components/presupuesto/AprobarBudgetButton";

export default async function PresupuestoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      budgetVersions: {
        orderBy: { createdAt: "desc" },
        include: {
          obraItems: true,
          muebleChapters: { include: { items: true } },
          artefactoItems: true,
          paymentTerms: true,
        },
      },
    },
  });

  if (!project) notFound();

  const obraVersions = project.budgetVersions.filter((b) => b.type === "obra");
  const muebleVersions = project.budgetVersions.filter(
    (b) => b.type === "muebles"
  );
  const artefactoVersions = project.budgetVersions.filter(
    (b) => b.type === "artefactos"
  );

  function calcObraTotal(budget: (typeof obraVersions)[0]) {
    const costoDirecto = budget.obraItems.reduce(
      (sum, item) => sum + item.total,
      0
    );
    const gg = costoDirecto * ((budget.ggPercentage || 0) / 100);
    const utilidad = costoDirecto * ((budget.utilityPercentage || 0) / 100);
    const neto = costoDirecto + gg + utilidad;
    const iva = neto * 0.19;
    return neto + iva;
  }

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
        <h1 className="text-2xl font-bold text-gray-900">Presupuestos</h1>
      </div>

      {/* Obra */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Presupuesto Obra
          </h2>
          <NuevaVersionButton projectId={project.id} type="obra" />
        </div>

        {obraVersions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No hay versiones de presupuesto de obra
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Version
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Fecha
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Partidas
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Total c/IVA
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Estado
                  </th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {obraVersions.map((budget) => {
                  const status =
                    BUDGET_STATUSES[budget.status as BudgetStatus];
                  const total = calcObraTotal(budget);
                  return (
                    <tr
                      key={budget.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/proyectos/${project.id}/presupuesto/${budget.id}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {budget.version}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(budget.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {budget.obraItems.length} items
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 text-right font-medium">
                        {new Intl.NumberFormat("es-CL", {
                          style: "currency",
                          currency: "CLP",
                          minimumFractionDigits: 0,
                        }).format(total)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${status?.color || ""}`}
                        >
                          {status?.label || budget.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <NuevaVersionButton
                            projectId={project.id}
                            type="obra"
                            baseVersionId={budget.id}
                            label="Duplicar"
                            variant="secondary"
                          />
                          <AprobarBudgetButton
                            budgetId={budget.id}
                            currentStatus={budget.status}
                            version={budget.version}
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

      {/* Muebles */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Presupuesto Muebles
          </h2>
          <NuevaVersionButton projectId={project.id} type="muebles" />
        </div>
        {muebleVersions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No hay versiones de presupuesto de muebles
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Version
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Fecha
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Items
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Estado
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {muebleVersions.map((budget) => {
                  const status =
                    BUDGET_STATUSES[budget.status as BudgetStatus];
                  return (
                    <tr
                      key={budget.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/proyectos/${project.id}/presupuesto/${budget.id}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {budget.version}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(budget.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {budget.muebleChapters.reduce((s, c) => s + c.items.length, 0)} items en {budget.muebleChapters.length} cap.
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${status?.color || ""}`}
                        >
                          {status?.label || budget.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <NuevaVersionButton
                            projectId={project.id}
                            type="muebles"
                            baseVersionId={budget.id}
                            label="Duplicar"
                            variant="secondary"
                          />
                          <AprobarBudgetButton
                            budgetId={budget.id}
                            currentStatus={budget.status}
                            version={budget.version}
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

      {/* Artefactos */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Presupuesto Artefactos
          </h2>
          <NuevaVersionButton projectId={project.id} type="artefactos" />
        </div>
        {artefactoVersions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No hay versiones de presupuesto de artefactos
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Version
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Fecha
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Items
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Estado
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {artefactoVersions.map((budget) => {
                  const status =
                    BUDGET_STATUSES[budget.status as BudgetStatus];
                  return (
                    <tr
                      key={budget.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/proyectos/${project.id}/presupuesto/${budget.id}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {budget.version}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(budget.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {budget.artefactoItems.length} items
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${status?.color || ""}`}
                        >
                          {status?.label || budget.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <NuevaVersionButton
                            projectId={project.id}
                            type="artefactos"
                            baseVersionId={budget.id}
                            label="Duplicar"
                            variant="secondary"
                          />
                          <AprobarBudgetButton
                            budgetId={budget.id}
                            currentStatus={budget.status}
                            version={budget.version}
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
    </div>
  );
}
