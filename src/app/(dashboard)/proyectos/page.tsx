import { prisma } from "@/lib/prisma";
import Link from "next/link";
import ProjectsTable, {
  type ProjectRow,
} from "@/components/proyecto/ProjectsTable";
import ListTabs from "@/components/proyecto/ListTabs";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
} from "@/lib/projects/metrics";
import { getLastActivity } from "@/lib/projects/lastActivity";

type SearchParams = { tab?: string };

export default async function ProyectosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const activeTab = sp.tab === "terminados" ? "terminados" : "ejecucion";

  // Para los conteos del header: solo proyectos reales (no centros de costo internos).
  // Para los conteos de los tabs: total (incluye internos) — el usuario los ve en la lista.
  const [ejecucionRealCount, terminadosRealCount, ejecucionTotalCount, terminadosTotalCount] = await Promise.all([
    prisma.project.count({ where: { status: "ejecucion", isInternal: false } }),
    prisma.project.count({ where: { status: "terminado", isInternal: false } }),
    prisma.project.count({ where: { status: "ejecucion" } }),
    prisma.project.count({ where: { status: "terminado" } }),
  ]);

  const projects = await prisma.project.findMany({
    where: { status: activeTab === "terminados" ? "terminado" : "ejecucion" },
    orderBy: [
      { isInternal: "asc" },
      { numeroProyecto: "asc" },
    ],
    include: PROJECT_METRICS_INCLUDE,
  });

  // Alertas: facturas vencidas pendientes de pago en cada proyecto
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueInvoices = await prisma.invoice.findMany({
    where: { type: "recibida", status: "pendiente", dueDate: { lt: today } },
    select: { projectId: true },
  });
  const overdueByProject = new Set(
    overdueInvoices.map((i) => i.projectId).filter(Boolean) as string[]
  );

  const rows: ProjectRow[] = projects.map((p) => {
    const m = computeProjectMetrics(p);
    return {
      id: p.id,
      numeroProyecto: p.numeroProyecto,
      numeroCotizacion: p.numeroCotizacion,
      isInternal: p.isInternal,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      gastado: m.totalGastado,
      vendido: m.totalAcordado,
      lastActivity: getLastActivity(p),
      hasAlert: overdueByProject.has(p.id),
    };
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {ejecucionRealCount} en ejecución · {terminadosRealCount} terminado
            {terminadosRealCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/proyectos/nuevo"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + Nuevo Proyecto
        </Link>
      </div>

      <ListTabs
        basePath="/proyectos"
        activeKey={activeTab}
        tabs={[
          { key: "ejecucion", label: "En ejecución", count: ejecucionTotalCount },
          { key: "terminados", label: "Terminados", count: terminadosTotalCount },
        ]}
      />

      <ProjectsTable
        rows={rows}
        variant={activeTab === "terminados" ? "terminado" : "ejecucion"}
        hrefBase="/proyectos"
        groupOtros
      />
    </div>
  );
}
