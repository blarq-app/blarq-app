import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FacturasFilterBar from "@/components/facturas/FacturasFilterBar";
import FacturasTable from "@/components/facturas/FacturasTable";
import SyncSiiButton from "@/components/facturas/SyncSiiButton";
import { formatCLP } from "@/lib/utils";

type SearchParams = {
  type?: "emitida" | "recibida";
  status?: "pendiente" | "parcial" | "pagada" | "anulada";
  origin?: "manual" | "sii_automatica";
  projectId?: string;
  tipoDoc?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
};

// Status tone moved to FacturasTable client component.

export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const where: Record<string, unknown> = {};
  if (sp.type) where.type = sp.type;
  if (sp.status) where.status = sp.status;
  if (sp.origin) where.origin = sp.origin;
  if (sp.projectId === "sin-asignar") where.projectId = null;
  else if (sp.projectId) where.projectId = sp.projectId;
  if (sp.tipoDoc) where.tipoDoc = Number(sp.tipoDoc);
  if (sp.categoryId) where.categoryId = sp.categoryId;
  if (sp.dateFrom || sp.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (sp.dateFrom) dateFilter.gte = new Date(sp.dateFrom);
    if (sp.dateTo) {
      // inclusivo: hasta el final del día
      const end = new Date(sp.dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.issueDate = dateFilter;
  }
  if (sp.q) {
    // mode "insensitive" para que la búsqueda matchee independiente de
    // mayúsculas/minúsculas. Es necesario en Postgres (en SQLite el LIKE
    // era case-insensitive por default; tras el cutover a Neon se rompió).
    where.OR = [
      { folioNumber: { contains: sp.q, mode: "insensitive" } },
      { businessName: { contains: sp.q, mode: "insensitive" } },
      { rutIssuer: { contains: sp.q, mode: "insensitive" } },
      { notes: { contains: sp.q, mode: "insensitive" } },
    ];
  }

  const [invoices, projects, categories] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issueDate: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      // Excluir el blob del PDF oficial — pesado (~170KB c/u) y solo lo
      // sirve el endpoint /api/facturas/[id]/pdf cuando se descarga.
      omit: { pdfContent: true },
      take: 500,
    }),
    prisma.project.findMany({
      orderBy: [{ numeroProyecto: "asc" }, { numeroCotizacion: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        numeroProyecto: true,
        numeroCotizacion: true,
      },
    }),
    prisma.costCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parent: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalEmitido = invoices
    .filter((i) => i.type === "emitida")
    .reduce((s, i) => s + i.totalAmount, 0);
  const totalRecibido = invoices
    .filter((i) => i.type === "recibida")
    .reduce((s, i) => s + i.totalAmount, 0);

  // Default desde el cual sincronizar SII (1 abril, fecha de corte de MJ)
  const SII_SYNC_FROM = "2026-04-01";

  // Cuántas facturas SII están sin asignar a proyecto — para destacar el
  // filtro y atraer la atención del usuario.
  const siiUnassignedCount = await prisma.invoice.count({
    where: { origin: "sii_automatica", projectId: null },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Facturas</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/facturas/reglas"
            className="text-xs text-gray-500 hover:text-gray-900 underline"
          >
            Reglas
          </Link>
          <SyncSiiButton defaultFrom={SII_SYNC_FROM} />
          <Link
            href="/facturas/nueva"
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            + Nueva factura
          </Link>
        </div>
      </div>

      {/* Atajo destacado a "facturas SII sin asignar a proyecto" cuando hay.
          Estilo gris/icono mono — sin morado, consistente con el sistema BLARQ. */}
      {siiUnassignedCount > 0 && sp.projectId !== "sin-asignar" && (
        <Link
          href="/facturas?origin=sii_automatica&projectId=sin-asignar"
          className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-4 hover:border-gray-400 transition-colors"
        >
          <span className="text-gray-500 text-base leading-none">⚐</span>
          <p className="text-sm text-gray-900 flex-1">
            <span className="font-semibold">
              {siiUnassignedCount} factura{siiUnassignedCount > 1 ? "s" : ""} del SII
            </span>{" "}
            sin asignar a proyecto — asignalas para que cuenten en su Estado de
            Resultados.
          </p>
          <span className="text-xs text-gray-500 underline">Ver →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Total" value={invoices.length.toString()} sub="facturas" />
        <Stat
          label="Emitido"
          value={formatCLP(totalEmitido)}
          sub="cobros al cliente"
        />
        <Stat
          label="Recibido"
          value={formatCLP(totalRecibido)}
          sub="gastos a proveedores"
        />
      </div>

      <FacturasFilterBar
        projects={projects}
        categories={categories}
        initial={{
          type: sp.type ?? "",
          status: sp.status ?? "",
          origin: sp.origin ?? "",
          projectId: sp.projectId ?? "",
          tipoDoc: sp.tipoDoc ?? "",
          categoryId: sp.categoryId ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
          q: sp.q ?? "",
        }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-4">
        {invoices.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">No hay facturas que coincidan con los filtros.</p>
            <Link
              href="/facturas/nueva"
              className="inline-block mt-3 text-sm text-gray-900 underline"
            >
              Crear una factura
            </Link>
          </div>
        ) : (
          <FacturasTable
            projects={projects}
            categories={categories}
            invoices={invoices.map((inv) => ({
              id: inv.id,
              type: inv.type,
              tipoDoc: inv.tipoDoc,
              folioNumber: inv.folioNumber,
              issueDate: inv.issueDate.toISOString(),
              businessName: inv.businessName,
              rutIssuer: inv.rutIssuer,
              totalAmount: inv.totalAmount,
              status: inv.status,
              origin: inv.origin,
              referenceFolioNumber: inv.referenceFolioNumber,
              siiCodigo: inv.siiCodigo,
              project: inv.project ? { id: inv.project.id, name: inv.project.name } : null,
              category: inv.category ? { id: inv.category.id, name: inv.category.name } : null,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
