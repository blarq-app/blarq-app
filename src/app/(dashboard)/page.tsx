import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
} from "@/lib/projects/metrics";
import { getLastActivity } from "@/lib/projects/lastActivity";
import ProjectsTable, {
  type ProjectRow,
} from "@/components/proyecto/ProjectsTable";
import Link from "next/link";

export default async function DashboardPage() {
  // Solo proyectos en ejecución (los terminados van a /proyectos > Terminados)
  const projects = await prisma.project.findMany({
    where: { status: "ejecucion" },
    orderBy: [
      { isInternal: "asc" }, // false antes que true
      { numeroProyecto: "asc" },
    ],
    include: PROJECT_METRICS_INCLUDE,
  });

  // Conteos para subtítulo y KPIs
  const [cotizacionCount, totalPendientePagar, totalPendienteCobrar, gastoMes] =
    await Promise.all([
      prisma.project.count({ where: { status: "cotizacion" } }),
      prisma.invoice
        .aggregate({
          _sum: { totalAmount: true },
          where: { type: "recibida", status: "pendiente" },
        })
        .then((r) => r._sum.totalAmount ?? 0),
      prisma.invoice
        .aggregate({
          _sum: { totalAmount: true },
          where: { type: "emitida", status: "pendiente" },
        })
        .then((r) => r._sum.totalAmount ?? 0),
      gastoDelMesActual(),
    ]);

  // Facturas SII sin asignar — banner
  const siiUnassignedCount = await prisma.invoice.count({
    where: { origin: "sii_automatica", projectId: null },
  });

  // Facturas vencidas pendientes de pago — para subtítulo + alerta por proyecto
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      type: "recibida",
      status: "pendiente",
      dueDate: { lt: today },
    },
    select: { projectId: true },
  });
  const overdueByProject = new Set(
    overdueInvoices.map((i) => i.projectId).filter(Boolean) as string[]
  );
  const overdueCount = overdueInvoices.length;

  // Filas para la tabla
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

  const subtitleParts = [
    `${rows.filter((r) => !r.isInternal).length} proyectos activos`,
    `${formatCLP(totalPendientePagar)} por pagar`,
  ];
  if (overdueCount > 0) {
    subtitleParts.push(
      `${overdueCount} factura${overdueCount > 1 ? "s" : ""} vencida${overdueCount > 1 ? "s" : ""}`
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {subtitleParts.join(" · ")}
          </p>
        </div>
        <Link
          href="/proyectos/nuevo"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + Nuevo Proyecto
        </Link>
      </div>

      {/* Banner de alertas — gris/icono mono, sin morado */}
      {siiUnassignedCount > 0 && (
        <Link
          href="/facturas?origin=sii_automatica&projectId=sin-asignar"
          className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-3 hover:border-gray-400 transition-colors"
        >
          <span className="text-gray-500 text-base leading-none">⚐</span>
          <p className="text-sm text-gray-900 flex-1">
            <span className="font-semibold">
              {siiUnassignedCount} factura{siiUnassignedCount > 1 ? "s" : ""} del SII
            </span>{" "}
            sin asignar a proyecto
          </p>
          <span className="text-xs text-gray-500 group-hover:text-gray-700">
            Asignar →
          </span>
        </Link>
      )}

      {/* KPIs en fila densa */}
      <div className="grid grid-cols-4 bg-white rounded-xl border border-gray-200 mb-6 divide-x divide-gray-200">
        <Stat label="En Cotización" value={cotizacionCount} href="/cotizaciones" />
        <Stat label="En Ejecución" value={rows.filter((r) => !r.isInternal).length} href="/proyectos" />
        <Stat
          label="Por Cobrar"
          subLabel="c/IVA"
          value={totalPendienteCobrar > 0 ? formatCLP(totalPendienteCobrar) : null}
        />
        <Stat
          label="Por Pagar"
          subLabel="c/IVA"
          value={totalPendientePagar > 0 ? formatCLP(totalPendientePagar) : null}
          tone={overdueCount > 0 ? "danger" : "default"}
        />
      </div>

      {/* Tabla de proyectos */}
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-900 uppercase tracking-wider">
          Proyectos en ejecución
        </h2>
        <Link
          href="/proyectos"
          className="text-xs text-gray-500 hover:text-gray-900 underline"
        >
          Ver todos →
        </Link>
      </div>
      <ProjectsTable
        rows={rows}
        variant="ejecucion"
        hrefBase="/proyectos"
        groupOtros
      />
    </div>
  );
}

// Suma de facturas recibidas con fecha de emisión en el mes actual.
async function gastoDelMesActual(): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const r = await prisma.invoice.aggregate({
    _sum: { totalAmount: true },
    where: { type: "recibida", issueDate: { gte: start, lt: end } },
  });
  return r._sum.totalAmount ?? 0;
}

function Stat({
  label,
  subLabel,
  value,
  href,
  tone = "default",
}: {
  label: string;
  subLabel?: string;
  value: string | number | null;
  href?: string;
  tone?: "default" | "danger";
}) {
  // Atenuar cuando no hay dato (null o 0)
  const isEmpty = value === null || value === 0 || value === "0";
  const display = isEmpty ? <span className="text-gray-300">—</span> : value;
  const valueClass =
    "mt-1 text-lg font-bold tabular-nums " +
    (tone === "danger" ? "text-red-700" : "text-gray-900");

  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
        {subLabel && (
          <span className="ml-1 normal-case text-gray-400">· {subLabel}</span>
        )}
      </p>
      <p className={valueClass}>{display}</p>
    </>
  );

  return href && !isEmpty ? (
    <Link href={href} className="px-4 py-3 hover:bg-gray-50 transition-colors block">
      {inner}
    </Link>
  ) : (
    <div className="px-4 py-3">{inner}</div>
  );
}
