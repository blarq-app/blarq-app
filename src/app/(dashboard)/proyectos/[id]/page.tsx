import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PROJECT_STATUSES, ProjectStatus, formatCLP, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function ProjectDetailPage({
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
        include: { obraItems: true },
      },
      invoices: {
        orderBy: { issueDate: "desc" },
      },
      estadosPago: {
        include: { items: true },
      },
      maestro: true,
    },
  });

  if (!project) {
    notFound();
  }

  const status = PROJECT_STATUSES[project.status as ProjectStatus];

  const totalEmitidas = project.invoices
    .filter((i) => i.type === "emitida")
    .reduce((sum, i) => sum + i.totalAmount, 0);

  const totalRecibidas = project.invoices
    .filter((i) => i.type === "recibida")
    .reduce((sum, i) => sum + i.totalAmount, 0);

  const porCobrar = project.invoices
    .filter((i) => i.type === "emitida" && i.status === "pendiente")
    .reduce((sum, i) => sum + i.totalAmount, 0);

  // Presupuesto aprobado (usa versión aprobada o la más reciente de obra)
  const approvedBudget =
    project.budgetVersions.find((b) => b.type === "obra" && b.status === "aprobado") ||
    project.budgetVersions.find((b) => b.type === "obra");

  function calcObraTotalWithIVA(budget: NonNullable<typeof project>["budgetVersions"][0]) {
    const costoDirecto = budget.obraItems.reduce((sum, it) => sum + it.total, 0);
    const gg = costoDirecto * ((budget.ggPercentage || 0) / 100);
    const utilidad = costoDirecto * ((budget.utilityPercentage || 0) / 100);
    const neto = costoDirecto + gg + utilidad;
    return neto * 1.19;
  }

  const presupuestoTotal = approvedBudget ? calcObraTotalWithIVA(approvedBudget) : 0;
  const pctCobrado = presupuestoTotal > 0 ? Math.round((totalEmitidas / presupuestoTotal) * 100) : 0;

  // % avance obra desde el último EP (mayor acumulado)
  const sortedEPs = [...project.estadosPago].sort((a, b) => a.number - b.number);
  const lastEP = sortedEPs[sortedEPs.length - 1];
  let pctObraAvanzada = 0;
  if (lastEP && lastEP.items.length > 0) {
    const totalLaborBudget = lastEP.items.reduce((sum, it) => sum + it.laborTotal, 0);
    const totalAcum = lastEP.items.reduce(
      (sum, it) => sum + (it.laborTotal * it.pctAccumulated) / 100,
      0
    );
    pctObraAvanzada = totalLaborBudget > 0 ? Math.round((totalAcum / totalLaborBudget) * 100) : 0;
  }

  // Utilidad real = facturado - costos
  const utilidadReal = totalEmitidas - totalRecibidas;
  const utilidadPct = totalEmitidas > 0 ? Math.round((utilidadReal / totalEmitidas) * 100) : 0;

  // Alerta de desviación: costos reales vs presupuesto de costos directos
  const presupuestoCostosDirectos = approvedBudget
    ? approvedBudget.obraItems.reduce((sum, it) => sum + it.total, 0)
    : 0;
  const desviacionPct =
    presupuestoCostosDirectos > 0
      ? Math.round(((totalRecibidas - presupuestoCostosDirectos) / presupuestoCostosDirectos) * 100)
      : 0;
  // Semáforo: verde <5%, amarillo 5-15%, rojo >15%
  const alertLevel =
    desviacionPct > 15 ? "rojo" : desviacionPct > 5 ? "amarillo" : "verde";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/proyectos"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              Proyectos
            </Link>
            <span className="text-gray-300">/</span>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          </div>
          <p className="text-gray-500">
            {project.clientName}
            {project.address && ` — ${project.address}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}
          >
            {status.label}
          </span>
          <Link
            href={`/proyectos/${project.id}/editar`}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Editar
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {/* Presupuesto aprobado */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">
            Presupuesto
            {approvedBudget?.status === "aprobado" && (
              <span className="ml-1 text-xs text-green-600 font-medium">aprobado</span>
            )}
          </p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {presupuestoTotal > 0 ? formatCLP(presupuestoTotal) : "—"}
          </p>
          {approvedBudget && (
            <p className="text-xs text-gray-400 mt-0.5">{approvedBudget.version}</p>
          )}
        </div>

        {/* % cobrado */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Cobrado</p>
          <p className="text-xl font-bold text-blue-600 mt-1">
            {pctCobrado}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCLP(totalEmitidas)}</p>
          {presupuestoTotal > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${Math.min(pctCobrado, 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* % obra avanzada */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Avance Obra</p>
          <p className="text-xl font-bold text-indigo-600 mt-1">
            {sortedEPs.length > 0 ? `${pctObraAvanzada}%` : "—"}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {sortedEPs.length > 0 ? `EP #${lastEP!.number} (último)` : "Sin estados de pago"}
          </p>
          {sortedEPs.length > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${Math.min(pctObraAvanzada, 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Utilidad real */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Utilidad Real</p>
          <p className={`text-xl font-bold mt-1 ${utilidadReal >= 0 ? "text-green-600" : "text-red-600"}`}>
            {totalEmitidas > 0 ? formatCLP(utilidadReal) : "—"}
          </p>
          {totalEmitidas > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{utilidadPct}% del facturado</p>
          )}
        </div>
      </div>

      {/* Alerta de desviación de costos */}
      {presupuestoCostosDirectos > 0 && totalRecibidas > 0 && alertLevel !== "verde" && (
        <div
          className={`rounded-lg p-4 mb-4 flex items-start gap-3 ${
            alertLevel === "rojo"
              ? "bg-red-50 border border-red-200"
              : "bg-yellow-50 border border-yellow-200"
          }`}
        >
          <span className="text-xl leading-none">
            {alertLevel === "rojo" ? "🔴" : "🟡"}
          </span>
          <div>
            <p className={`text-sm font-medium ${alertLevel === "rojo" ? "text-red-800" : "text-yellow-800"}`}>
              {alertLevel === "rojo" ? "Alerta de costos" : "Advertencia de costos"}
            </p>
            <p className={`text-sm mt-0.5 ${alertLevel === "rojo" ? "text-red-700" : "text-yellow-700"}`}>
              Los costos registrados ({formatCLP(totalRecibidas)}) superan el presupuesto de costos
              directos en un <strong>{desviacionPct}%</strong> ({formatCLP(totalRecibidas - presupuestoCostosDirectos)} sobre lo presupuestado).
            </p>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Link
          href={`/proyectos/${project.id}/presupuesto`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Presupuestos
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {project.budgetVersions.length} versiones
          </p>
        </Link>
        <Link
          href={`/proyectos/${project.id}/facturas`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Facturas
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {project.invoices.length} totales ·{" "}
            {project.invoices.filter((i) => i.type === "emitida").length} emitidas
            · {project.invoices.filter((i) => i.type === "recibida").length} recibidas
          </p>
        </Link>
        <Link
          href={`/proyectos/${project.id}/estados-pago`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Estados de Pago
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {project.estadosPago.length} emitidos
            {project.maestro ? ` · ${project.maestro.name}` : " · sin maestro"}
          </p>
        </Link>
        <Link
          href={`/proyectos/${project.id}/lista-compra`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Lista de Compra
          </h3>
          <p className="text-sm text-gray-500 mt-1">Materiales a comprar</p>
        </Link>
        <Link
          href={`/proyectos/${project.id}/resultados`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Estado de Resultados
          </h3>
          <p className="text-sm text-gray-500 mt-1">Ver resumen financiero</p>
        </Link>
      </div>

      {/* Project details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Datos del Proyecto
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <dt className="text-sm text-gray-500">Cliente</dt>
            <dd className="text-sm font-medium text-gray-900 mt-0.5">
              {project.clientName}
            </dd>
          </div>
          {project.clientPhone && (
            <div>
              <dt className="text-sm text-gray-500">Telefono</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {project.clientPhone}
              </dd>
            </div>
          )}
          {project.clientEmail && (
            <div>
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {project.clientEmail}
              </dd>
            </div>
          )}
          {project.address && (
            <div>
              <dt className="text-sm text-gray-500">Direccion</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {project.address}
              </dd>
            </div>
          )}
          {project.startDate && (
            <div>
              <dt className="text-sm text-gray-500">Fecha Inicio</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {formatDate(project.startDate)}
              </dd>
            </div>
          )}
          {project.estimatedEndDate && (
            <div>
              <dt className="text-sm text-gray-500">Fecha Fin Estimada</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {formatDate(project.estimatedEndDate)}
              </dd>
            </div>
          )}
          {project.ufReference && (
            <div>
              <dt className="text-sm text-gray-500">UF Referencia</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {project.ufReference.toLocaleString("es-CL")}
              </dd>
            </div>
          )}
          {project.notes && (
            <div className="md:col-span-2">
              <dt className="text-sm text-gray-500">Notas</dt>
              <dd className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap">
                {project.notes}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
