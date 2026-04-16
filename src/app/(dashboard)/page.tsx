import { prisma } from "@/lib/prisma";
import { formatCLP, PROJECT_STATUSES, ProjectStatus } from "@/lib/utils";
import Link from "next/link";

export default async function DashboardPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      invoices: true,
    },
  });

  const activeProjects = projects.filter(
    (p) => p.status !== "terminado"
  );

  const totalByStatus = {
    cotizacion: projects.filter((p) => p.status === "cotizacion").length,
    aprobado: projects.filter((p) => p.status === "aprobado").length,
    en_ejecucion: projects.filter((p) => p.status === "en_ejecucion").length,
    terminado: projects.filter((p) => p.status === "terminado").length,
  };

  const totalPorCobrar = projects.reduce((acc, p) => {
    const emitidas = p.invoices
      .filter((i) => i.type === "emitida" && i.status === "pendiente")
      .reduce((sum, i) => sum + i.totalAmount, 0);
    return acc + emitidas;
  }, 0);

  const totalPorPagar = projects.reduce((acc, p) => {
    const recibidas = p.invoices
      .filter((i) => i.type === "recibida" && i.status === "pendiente")
      .reduce((sum, i) => sum + i.totalAmount, 0);
    return acc + recibidas;
  }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link
          href="/proyectos/nuevo"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + Nuevo Proyecto
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">En Cotización</p>
          <p className="text-3xl font-bold text-yellow-600 mt-1">
            {totalByStatus.cotizacion}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">En Ejecución</p>
          <p className="text-3xl font-bold text-green-600 mt-1">
            {totalByStatus.en_ejecucion}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Por Cobrar</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {formatCLP(totalPorCobrar)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Por Pagar</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {formatCLP(totalPorPagar)}
          </p>
        </div>
      </div>

      {/* Active projects */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Proyectos Activos
          </h2>
        </div>
        {activeProjects.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-lg mb-2">No hay proyectos activos</p>
            <Link
              href="/proyectos/nuevo"
              className="text-gray-900 underline text-sm"
            >
              Crear primer proyecto
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeProjects.map((project) => {
              const status = PROJECT_STATUSES[project.status as ProjectStatus];
              return (
                <Link
                  key={project.id}
                  href={`/proyectos/${project.id}`}
                  className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {project.name}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {project.clientName}
                      {project.address && ` — ${project.address}`}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}
                  >
                    {status.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
