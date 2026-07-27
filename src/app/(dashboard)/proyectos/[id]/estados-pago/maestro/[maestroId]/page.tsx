import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCLP, formatDate } from "@/lib/utils";
import { findLatestObraBudget } from "@/lib/ep/snapshot";
import NuevoEPButton from "@/components/estadosPago/NuevoEPButton";
import EliminarEPButton from "@/components/estadosPago/EliminarEPButton";
import PartidaAssigner, {
  type AssignerItem,
} from "@/components/estadosPago/PartidaAssigner";

export default async function MaestroEstadosPagoPage({
  params,
}: {
  params: Promise<{ id: string; maestroId: string }>;
}) {
  const { id: projectId, maestroId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // El maestro debe estar vinculado a la obra.
  const link = await prisma.projectMaestro.findUnique({
    where: { projectId_maestroId: { projectId, maestroId } },
    include: { maestro: true },
  });
  if (!link) notFound();
  const maestro = link.maestro;

  // Versión de obra vigente + partidas (para el selector).
  const budget = await findLatestObraBudget(prisma, projectId);

  // Todas las versiones de obra, para que MJ pueda elegir a mano sobre cuál
  // armar el EP (default: la vigente = la que devuelve findLatestObraBudget).
  const obraVersions = await prisma.budgetVersion.findMany({
    where: { projectId, type: "obra" },
    select: { id: true, version: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Nombres de maestros con partidas en esta versión, para etiquetar "de otro".
  const otherMaestros = budget
    ? await prisma.maestro.findMany({
        where: { obraItems: { some: { budgetVersionId: budget.id } } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(otherMaestros.map((m) => [m.id, m.name]));

  const assignerItems: AssignerItem[] = (budget?.obraItems ?? []).map((it) => ({
    id: it.id,
    itemNumber: it.itemNumber,
    chapterId: it.chapterId,
    subChapter: it.subChapter,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    sortOrder: it.sortOrder,
    assignedToThis: it.maestroId === maestroId,
    otherMaestroName:
      it.maestroId && it.maestroId !== maestroId
        ? nameById.get(it.maestroId) ?? null
        : null,
  }));
  const assignedCount = assignerItems.filter((i) => i.assignedToThis).length;

  // EPs de este maestro.
  const eps = await prisma.estadoPago.findMany({
    where: { projectId, maestroId },
    orderBy: { number: "desc" },
    include: { items: true },
  });

  // Monto por EP (mismo cálculo que la vista general).
  const sorted = [...eps].sort((a, b) => a.number - b.number);
  const epAcum = sorted.map((ep) =>
    ep.items.reduce(
      (sum, it) => sum + (it.laborTotal * it.pctAccumulated) / 100,
      0
    )
  );
  const epThis = epAcum.map((t, i) => t - (i > 0 ? epAcum[i - 1] : 0));
  const amountById = new Map<string, number>();
  sorted.forEach((ep, i) => amountById.set(ep.id, epThis[i]));

  return (
    <div>
      <div className="mb-4">
        <Link
          href={`/proyectos/${projectId}/estados-pago`}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Maestros de la obra
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-medium text-gray-900">{maestro.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {assignedCount} partida{assignedCount !== 1 ? "s" : ""} asignada
            {assignedCount !== 1 ? "s" : ""}
            {maestro.phone && ` · ${maestro.phone}`}
            {maestro.emitsInvoice && " · emite factura"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {budget && (
            <a
              href={`/api/presupuestos/${budget.id}/maestro?format=pdf&maestroId=${maestroId}`}
              target="_blank"
              className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              title="PDF con solo las partidas de este maestro, sin precios"
            >
              Alcance PDF
            </a>
          )}
          <NuevoEPButton
            projectId={projectId}
            maestroId={maestroId}
            label="+ Nuevo EP"
            disabled={assignedCount === 0}
            versions={obraVersions.map((v) => ({
              id: v.id,
              version: v.version,
              status: v.status,
            }))}
            defaultVersionId={budget?.id}
          />
        </div>
      </div>

      {/* Estados de pago de este maestro (arriba: es lo principal) */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">
          Estados de pago de {maestro.name}
        </h3>
      </div>

      {assignedCount === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          Asigná partidas a este maestro (arriba) antes de crear su primer estado
          de pago.
        </div>
      ) : eps.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">
            Todavía no hay estados de pago para este maestro.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  EP N°
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Fecha
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Estado
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  A pagar
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {eps.map((ep) => (
                <tr key={ep.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    EP #{ep.number}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(ep.date)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                      {ep.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">
                    {formatCLP(amountById.get(ep.id) || 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/proyectos/${projectId}/estados-pago/${ep.id}`}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Abrir
                      </Link>
                      <EliminarEPButton
                        epId={ep.id}
                        epNumber={ep.number}
                        status={ep.status}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reparto de partidas — colapsado por default una vez asignadas, para no
          tapar los EPs. Se despliega si MJ quiere cambiar el reparto. */}
      <div className="mt-8">
        <PartidaAssigner
          projectId={projectId}
          maestroId={maestroId}
          chapters={budget?.obraChapters ?? []}
          items={assignerItems}
        />
      </div>
    </div>
  );
}
