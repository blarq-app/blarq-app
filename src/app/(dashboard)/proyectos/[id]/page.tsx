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
      },
      invoices: {
        orderBy: { issueDate: "desc" },
      },
      estadosPago: true,
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

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Version Actual</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {project.currentVersion}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Facturado al Cliente</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {formatCLP(totalEmitidas)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Costos Registrados</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {formatCLP(totalRecibidas)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Por Cobrar</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">
            {formatCLP(porCobrar)}
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
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
          href={`/proyectos/${project.id}/costos`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Control de Costos
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {project.invoices.filter((i) => i.type === "recibida").length}{" "}
            facturas recibidas
          </p>
        </Link>
        <Link
          href={`/proyectos/${project.id}/facturacion`}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors group"
        >
          <h3 className="font-medium text-gray-900 group-hover:underline">
            Facturacion
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {project.invoices.filter((i) => i.type === "emitida").length}{" "}
            facturas emitidas
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
