import { prisma } from "@/lib/prisma";
import { formatCLP, PROJECT_STATUSES, ProjectStatus } from "@/lib/utils";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
} from "@/lib/projects/metrics";
import Link from "next/link";

export default async function DashboardPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: PROJECT_METRICS_INCLUDE,
  });

  const projectsWithMetrics = projects.map((p) => ({
    project: p,
    metrics: computeProjectMetrics(p),
  }));

  const activeProjects = projectsWithMetrics.filter(
    (x) => x.project.status !== "terminado"
  );

  const totalByStatus = {
    cotizacion: projects.filter((p) => p.status === "cotizacion").length,
    aprobado: projects.filter((p) => p.status === "aprobado").length,
    en_ejecucion: projects.filter((p) => p.status === "en_ejecucion").length,
    terminado: projects.filter((p) => p.status === "terminado").length,
  };

  const totalPorCobrar = projectsWithMetrics.reduce((acc, x) => {
    return (
      acc +
      x.project.invoices
        .filter((i) => i.type === "emitida" && i.status === "pendiente")
        .reduce((s, i) => s + i.totalAmount, 0)
    );
  }, 0);

  const totalPorPagar = projectsWithMetrics.reduce((acc, x) => {
    return (
      acc +
      x.project.invoices
        .filter((i) => i.type === "recibida" && i.status === "pendiente")
        .reduce((s, i) => s + i.totalAmount, 0)
    );
  }, 0);

  // Alertas globales: facturas vencidas, proyectos con desviaciones críticas
  const totalOverdueInvoices = projectsWithMetrics.reduce(
    (s, x) => s + x.metrics.invoicesOverdueCount,
    0
  );
  const projectsWithDanger = projectsWithMetrics.filter((x) =>
    x.metrics.alerts.some((a) => a.severity === "danger")
  );

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

      {/* Banners globales */}
      {(totalOverdueInvoices > 0 || projectsWithDanger.length > 0) && (
        <div className="mb-6 space-y-2">
          {totalOverdueInvoices > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-red-600 text-lg">⚠</span>
                <p className="text-sm text-red-900">
                  <span className="font-semibold">
                    {totalOverdueInvoices} factura
                    {totalOverdueInvoices > 1 ? "s" : ""}
                  </span>{" "}
                  vencida{totalOverdueInvoices > 1 ? "s" : ""} pendiente
                  {totalOverdueInvoices > 1 ? "s" : ""} de pago
                </p>
              </div>
              <Link
                href="/facturas?status=pendiente&type=recibida"
                className="text-xs text-red-800 underline hover:text-red-900"
              >
                Ver facturas →
              </Link>
            </div>
          )}
          {projectsWithDanger.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="text-amber-700 text-lg">⚠</span>
              <p className="text-sm text-amber-900">
                <span className="font-semibold">
                  {projectsWithDanger.length} proyecto
                  {projectsWithDanger.length > 1 ? "s" : ""}
                </span>{" "}
                con alguna categoría excedida o factura vencida — revisá las
                tarjetas abajo.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Stat
          label="En Cotización"
          value={totalByStatus.cotizacion.toString()}
          accent="text-yellow-600"
        />
        <Stat
          label="En Ejecución"
          value={totalByStatus.en_ejecucion.toString()}
          accent="text-green-600"
        />
        <Stat
          label="Por Cobrar"
          value={formatCLP(totalPorCobrar)}
          accent="text-blue-600"
          dense
        />
        <Stat
          label="Por Pagar"
          value={formatCLP(totalPorPagar)}
          accent="text-red-600"
          dense
        />
      </div>

      {/* Active projects */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Proyectos Activos
        </h2>
        <Link
          href="/proyectos"
          className="text-xs text-gray-500 hover:text-gray-900 underline"
        >
          Ver todos
        </Link>
      </div>
      {activeProjects.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <p className="text-lg mb-2">No hay proyectos activos</p>
          <Link
            href="/proyectos/nuevo"
            className="text-gray-900 underline text-sm"
          >
            Crear primer proyecto
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {activeProjects.map((x) => (
            <ProjectCard key={x.project.id} project={x.project} metrics={x.metrics} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  dense,
}: {
  label: string;
  value: string;
  accent: string;
  dense?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p
        className={`mt-1 font-bold tabular-nums ${accent} ${dense ? "text-xl" : "text-3xl"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ProjectCard({
  project,
  metrics,
}: {
  project: { id: string; name: string; clientName: string; status: string };
  metrics: ReturnType<typeof computeProjectMetrics>;
}) {
  const status = PROJECT_STATUSES[project.status as ProjectStatus];
  const dangerAlerts = metrics.alerts.filter((a) => a.severity === "danger");
  const warningAlerts = metrics.alerts.filter((a) => a.severity === "warning");

  // Pedido por MJ: la card debe mostrar a simple vista cuánto se vendió
  // y cuánto se gastó, con una alerta si hay algo crítico. Click → Resumen
  // del proyecto donde están todos los detalles.
  const hasDanger = dangerAlerts.length > 0;
  const hasWarning = warningAlerts.length > 0 && !hasDanger;

  return (
    <Link
      href={`/proyectos/${project.id}/resumen`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-gray-400 p-5 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">
            {project.name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {project.clientName}
          </p>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded flex-shrink-0 ${status.color}`}
        >
          {status.label}
        </span>
      </div>

      {/* Lo central: vendido vs gastado */}
      <div className="grid grid-cols-2 gap-4 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Vendido
          </p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">
            {formatCLP(metrics.totalAcordado)}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            cobrado {metrics.pctCobrado.toFixed(0)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Gastado
          </p>
          <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">
            {formatCLP(metrics.totalGastado)}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            avance obra {metrics.avanceObraPct.toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Alerta crítica solo si la hay */}
      {hasDanger && (
        <div className="border-t border-gray-100 pt-2 mt-2 flex items-start gap-1.5 text-[11px] text-red-700">
          <span>⚠</span>
          <span className="flex-1">{dangerAlerts[0].message}</span>
          {metrics.alerts.length > 1 && (
            <span className="text-gray-400">
              +{metrics.alerts.length - 1}
            </span>
          )}
        </div>
      )}
      {hasWarning && (
        <div className="border-t border-gray-100 pt-2 mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
          <span>•</span>
          <span className="flex-1">{warningAlerts[0].message}</span>
        </div>
      )}
    </Link>
  );
}

