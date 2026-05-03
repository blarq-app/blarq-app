import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FacturasFilterBar from "@/components/facturas/FacturasFilterBar";
import SyncSiiButton from "@/components/facturas/SyncSiiButton";
import { formatCLP, formatDate } from "@/lib/utils";

type SearchParams = {
  type?: "emitida" | "recibida";
  status?: "pendiente" | "parcial" | "pagada" | "anulada";
  origin?: "manual" | "sii_automatica";
  projectId?: string;
  q?: string;
};

const STATUS_TONE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  parcial: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-500",
};

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
  if (sp.q) {
    where.OR = [
      { folioNumber: { contains: sp.q } },
      { businessName: { contains: sp.q } },
      { rutIssuer: { contains: sp.q } },
      { notes: { contains: sp.q } },
    ];
  }

  const [invoices, projects] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issueDate: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      take: 500,
    }),
    prisma.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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
          <SyncSiiButton from={SII_SYNC_FROM} />
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
        initial={{
          type: sp.type ?? "",
          status: sp.status ?? "",
          origin: sp.origin ?? "",
          projectId: sp.projectId ?? "",
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
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Folio</th>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Emisor</th>
                <th className="text-left px-4 py-2">Proyecto</th>
                <th className="text-left px-4 py-2">Categoría</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-left px-4 py-2">Origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] uppercase px-1.5 py-0.5 rounded tracking-wider ${
                        inv.type === "emitida"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-orange-100 text-orange-800"
                      }`}
                    >
                      {inv.type}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-gray-700">
                    <Link
                      href={`/facturas/${inv.id}`}
                      className="hover:text-gray-900 hover:underline"
                    >
                      {inv.folioNumber || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                    {formatDate(inv.issueDate)}
                  </td>
                  <td className="px-4 py-2 text-gray-700 truncate max-w-[200px]">
                    {inv.businessName || inv.rutIssuer || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-700 truncate max-w-[180px]">
                    {inv.project ? (
                      <Link
                        href={`/proyectos/${inv.project.id}`}
                        className="hover:underline"
                      >
                        {inv.project.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400 italic">sin asignar</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {inv.category?.name ?? (
                      <span className="text-gray-400 italic">sin categoría</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-900">
                    {formatCLP(inv.totalAmount)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        STATUS_TONE[inv.status] || "bg-gray-100"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        inv.origin === "sii_automatica"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {inv.origin === "sii_automatica" ? "SII" : "manual"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
