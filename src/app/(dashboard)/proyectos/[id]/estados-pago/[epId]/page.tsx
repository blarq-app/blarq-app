import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditorEP from "@/components/estadosPago/EditorEP";
import { esSinManoDeObra } from "@/lib/ep/hideNoLabor";
import { selectVigente } from "@/lib/projects/selectVersion";

export default async function EPDetailPage({
  params,
}: {
  params: Promise<{ id: string; epId: string }>;
}) {
  const { id: projectId, epId } = await params;

  const ep = await prisma.estadoPago.findUnique({
    where: { id: epId },
    include: {
      project: { include: { maestro: true } },
      maestro: true,
      items: { orderBy: { sortOrder: "asc" } },
      budgetVersion: { select: { id: true, version: true, status: true } },
    },
  });

  if (!ep || ep.projectId !== projectId) notFound();

  // EPs previos para calcular acumulado por partida + histórico.
  // Se scopean a la MISMA serie: cada maestro lleva su numeración, así que el
  // acumulado anterior de un EP de maestro solo mira los EPs de ese maestro
  // (los legacy sin maestro son su propia serie con maestroId null).
  const prevEps = await prisma.estadoPago.findMany({
    where: { projectId, maestroId: ep.maestroId, number: { lt: ep.number } },
    orderBy: { number: "asc" },
    include: { items: true },
  });
  // Solo los CERRADOS cuentan para "previo"; los borradores anteriores no.
  const prevClosedEps = prevEps.filter((p) => p.status === "cerrado");

  // Indexamos por lineageId (no por obraItemId) para que la herencia entre
  // EPs sobreviva un cambio de versión del presupuesto.
  const prevExecutedByLineage: Record<string, number> = {};
  const prevAmountPaidByLineage: Record<string, number> = {};
  for (const p of prevClosedEps) {
    for (const i of p.items) {
      prevExecutedByLineage[i.lineageId] = Math.max(
        prevExecutedByLineage[i.lineageId] ?? 0,
        i.quantityExecuted
      );
      prevAmountPaidByLineage[i.lineageId] =
        (prevAmountPaidByLineage[i.lineageId] ?? 0) + (i.amountPaid ?? 0);
    }
  }

  // Resumen de EPs previos para el bloque "Histórico"
  const previousEpsSummary = prevClosedEps.map((p) => ({
    id: p.id,
    number: p.number,
    date: p.date.toISOString(),
    closedAt: p.closedAt?.toISOString() ?? null,
    totalPaid: p.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0),
  }));

  // Partidas a esconder: las que no llevan mano de obra de este maestro (son
  // material/subcontrato de un tercero, ej. "espejo a medida"). Se lee el costo
  // "por otro lado" del ObraItem vigente; el snapshot del EP no lo guarda.
  const obraItemIds = ep.items
    .map((i) => i.obraItemId)
    .filter((v): v is string => !!v);
  const obraItemsCosto = obraItemIds.length
    ? await prisma.obraItem.findMany({
        where: { id: { in: obraItemIds } },
        select: {
          id: true,
          costMaterial: true,
          costSubcontract: true,
          costTools: true,
        },
      })
    : [];
  const costoByObraItemId = new Map(obraItemsCosto.map((o) => [o.id, o]));
  const hiddenItemIds = ep.items
    .filter((i) =>
      esSinManoDeObra(i.laborUnitPrice, costoByObraItemId.get(i.obraItemId))
    )
    .map((i) => i.id);

  // ¿Este EP está armado sobre una versión distinta de la VIGENTE del proyecto?
  // Se usa el criterio único (selectVigente), el MISMO que el backend de sync,
  // para que el aviso no muestre una versión contra la que después no sincroniza.
  const obraVersions = await prisma.budgetVersion.findMany({
    where: { projectId, type: "obra" },
    select: { id: true, version: true, status: true, createdAt: true },
  });
  const vigente = selectVigente(obraVersions);
  const latestBudgetVersion = vigente
    ? { id: vigente.id, version: vigente.version }
    : null;
  const hasNewerVersion =
    latestBudgetVersion != null &&
    ep.budgetVersionId != null &&
    latestBudgetVersion.id !== ep.budgetVersionId;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link
          href={`/proyectos/${projectId}/estados-pago`}
          className="text-gray-500 hover:text-gray-900"
        >
          ← Estados de Pago
        </Link>
        <span className="text-gray-300">/</span>
        <span className="font-medium text-gray-900">EP #{ep.number}</span>
      </div>

      <EditorEP
        ep={JSON.parse(JSON.stringify(ep))}
        prevExecutedByLineage={prevExecutedByLineage}
        prevAmountPaidByLineage={prevAmountPaidByLineage}
        previousEps={previousEpsSummary}
        latestBudgetVersion={
          latestBudgetVersion
            ? { id: latestBudgetVersion.id, version: latestBudgetVersion.version }
            : null
        }
        hasNewerVersion={hasNewerVersion}
        hiddenItemIds={hiddenItemIds}
      />
    </div>
  );
}
