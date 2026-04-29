import { prisma } from "@/lib/prisma";
import Link from "next/link";
import ProjectsTable, {
  type ProjectRow,
} from "@/components/proyecto/ProjectsTable";
import ListTabs from "@/components/proyecto/ListTabs";
import { computeProjectMetrics, PROJECT_METRICS_INCLUDE } from "@/lib/projects/metrics";
import { getLastActivity } from "@/lib/projects/lastActivity";

type SearchParams = { tab?: string };

export default async function CotizacionesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const activeTab =
    sp.tab === "archivadas" || sp.tab === "convertidas" ? sp.tab : "activas";

  // Conteos para los tabs
  const [activasCount, archivadasCount, convertidasCount] = await Promise.all([
    prisma.project.count({ where: { status: "cotizacion" } }),
    prisma.project.count({ where: { status: "archivado" } }),
    // Convertidas = la cotización ya pasó a proyecto: tiene numeroProyecto != null y no es interna
    prisma.project.count({
      where: {
        isInternal: false,
        numeroProyecto: { not: null },
        status: { in: ["ejecucion", "terminado"] },
      },
    }),
  ]);

  // Filtro según tab
  const where =
    activeTab === "activas"
      ? { status: "cotizacion" }
      : activeTab === "archivadas"
        ? { status: "archivado" }
        : {
            isInternal: false,
            numeroProyecto: { not: null },
            status: { in: ["ejecucion", "terminado"] as string[] },
          };

  const projects = await prisma.project.findMany({
    where,
    orderBy: { numeroCotizacion: "asc" },
    include: PROJECT_METRICS_INCLUDE,
  });

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
      // Para cotizaciones: el "monto" se interpreta como totalAcordado del
      // presupuesto (lo cobrado al cliente, c/IVA). Vendido reflejará eso.
      vendido: m.totalAcordado,
      lastActivity: getLastActivity(p),
      hasAlert: false,
      convertedAt: activeTab === "convertidas" ? p.updatedAt : null,
    };
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cotizaciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activasCount} activa{activasCount !== 1 ? "s" : ""} · {archivadasCount}{" "}
            archivada{archivadasCount !== 1 ? "s" : ""} · {convertidasCount} convertida
            {convertidasCount !== 1 ? "s" : ""} en proyecto
          </p>
        </div>
        <Link
          href="/proyectos/nuevo"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + Nueva Cotización
        </Link>
      </div>

      <ListTabs
        basePath="/cotizaciones"
        activeKey={activeTab}
        tabs={[
          { key: "activas", label: "Activas", count: activasCount },
          { key: "archivadas", label: "Archivadas", count: archivadasCount },
          { key: "convertidas", label: "Convertidas", count: convertidasCount },
        ]}
      />

      <ProjectsTable
        rows={rows}
        variant={
          activeTab === "convertidas"
            ? "convertida"
            : activeTab === "archivadas"
              ? "archivado"
              : "cotizacion"
        }
        hrefBase="/proyectos"
      />
    </div>
  );
}
