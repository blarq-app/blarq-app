import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, formatDate } from "@/lib/utils";
import Link from "next/link";
import { findLatestObraBudget } from "@/lib/ep/snapshot";
import NuevoEPButton from "@/components/estadosPago/NuevoEPButton";
import EliminarEPButton from "@/components/estadosPago/EliminarEPButton";
import AddMaestroButton from "@/components/estadosPago/AddMaestroButton";

export default async function EstadosPagoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      maestro: true,
      projectMaestros: { include: { maestro: true } },
      estadosPago: {
        orderBy: { number: "desc" },
        include: { items: true, maestro: true },
      },
    },
  });
  if (!project) notFound();

  // Versión de obra vigente — fuente de las partidas y su asignación a maestros.
  const obraBudget = await findLatestObraBudget(prisma, id);
  const obraItems = obraBudget?.obraItems ?? [];
  const hasObra = obraItems.length > 0;

  // Conteos de partidas por maestro + sin asignar (sobre la versión vigente).
  const partidasByMaestro = new Map<string, number>();
  let sinAsignar = 0;
  for (const it of obraItems) {
    if (it.maestroId) {
      partidasByMaestro.set(
        it.maestroId,
        (partidasByMaestro.get(it.maestroId) ?? 0) + 1
      );
    } else {
      sinAsignar++;
    }
  }

  // Monto por EP (Σ laborTotal·%acum − acumulado del EP anterior de la MISMA
  // serie). Se calcula por serie: cada maestro tiene su propia numeración, y
  // los EPs legacy (sin maestro) son su propia serie.
  const amountById = new Map<string, number>();
  const bySerie = new Map<string, typeof project.estadosPago>();
  for (const ep of project.estadosPago) {
    const key = ep.maestroId ?? "__legacy__";
    if (!bySerie.has(key)) bySerie.set(key, []);
    bySerie.get(key)!.push(ep);
  }
  for (const serie of bySerie.values()) {
    const sorted = [...serie].sort((a, b) => a.number - b.number);
    const acum = sorted.map((ep) =>
      ep.items.reduce(
        (sum, it) => sum + (it.laborTotal * it.pctAccumulated) / 100,
        0
      )
    );
    sorted.forEach((ep, i) =>
      amountById.set(ep.id, acum[i] - (i > 0 ? acum[i - 1] : 0))
    );
  }

  const maestrosEnObra = project.projectMaestros;
  const epCountByMaestro = new Map<string, number>();
  for (const ep of project.estadosPago) {
    if (ep.maestroId)
      epCountByMaestro.set(
        ep.maestroId,
        (epCountByMaestro.get(ep.maestroId) ?? 0) + 1
      );
  }
  const legacyEps = project.estadosPago.filter((ep) => !ep.maestroId);

  // Maestros disponibles para agregar (no vinculados aún a esta obra).
  const enObraIds = new Set(maestrosEnObra.map((pm) => pm.maestroId));
  const allMaestros = await prisma.maestro.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const available = allMaestros.filter((m) => !enObraIds.has(m.id));

  return (
    <div>
      {/* ============ Maestros de la obra ============ */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Maestros de la obra</h3>
        <AddMaestroButton projectId={id} available={available} />
      </div>

      {!hasObra && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm mb-6">
          Para repartir partidas y crear estados de pago, esta obra necesita
          primero un presupuesto de obra con partidas.
        </div>
      )}

      {maestrosEnObra.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8 text-sm text-gray-500">
          Todavía no hay maestros repartidos en esta obra. Agregá los que trabajan
          (obra gruesa, porcelanato, etc.) para darle a cada uno sus partidas y
          llevar sus estados de pago por separado.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {maestrosEnObra.map((pm) => {
            const cnt = partidasByMaestro.get(pm.maestroId) ?? 0;
            const epc = epCountByMaestro.get(pm.maestroId) ?? 0;
            return (
              <Link
                key={pm.id}
                href={`/proyectos/${id}/estados-pago/maestro/${pm.maestroId}`}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-400 transition-colors"
              >
                <p className="text-base font-medium text-gray-900">
                  {pm.maestro.name}
                </p>
                <p className="text-sm text-gray-500 mt-1 tabular-nums">
                  {cnt} partida{cnt !== 1 ? "s" : ""} · {epc} EP
                  {epc !== 1 ? "s" : ""}
                </p>
              </Link>
            );
          })}

          {/* Cajón "sin asignar" */}
          <div className="rounded-xl border border-dashed border-gray-300 p-4">
            <p className="text-base font-medium text-gray-500">Sin asignar</p>
            <p className="text-sm text-gray-400 mt-1 tabular-nums">
              {sinAsignar} partida{sinAsignar !== 1 ? "s" : ""} fuera de todo EP
            </p>
          </div>
        </div>
      )}

      {/* ============ Obra completa (legacy / sin repartir) ============ */}
      {/* Se muestra el flujo de EP de obra completa solo si la obra todavía no
          se repartió por maestro (sin ProjectMaestro), o si quedan EPs viejos
          sin maestro. Así las obras de un solo maestro siguen igual que antes. */}
      {(legacyEps.length > 0 || maestrosEnObra.length === 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">
              {maestrosEnObra.length === 0
                ? "Estados de pago"
                : "Obra completa (sin repartir)"}
            </h3>
            {maestrosEnObra.length === 0 && (
              <NuevoEPButton projectId={id} disabled={!hasObra} />
            )}
          </div>

          {legacyEps.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500 text-sm">
                Aún no hay estados de pago emitidos para este proyecto.
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
                  {legacyEps.map((ep) => (
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
                            href={`/proyectos/${id}/estados-pago/${ep.id}`}
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
        </div>
      )}
    </div>
  );
}
