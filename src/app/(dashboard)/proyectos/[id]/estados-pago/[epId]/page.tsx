import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditorEP from "@/components/estadosPago/EditorEP";

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
      items: { orderBy: { sortOrder: "asc" } },
      budgetVersion: { select: { id: true, version: true, status: true } },
    },
  });

  if (!ep || ep.projectId !== projectId) notFound();

  // EPs previos para calcular acumulado por partida + histórico
  const prevEps = await prisma.estadoPago.findMany({
    where: { projectId, number: { lt: ep.number } },
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

  // ¿Hay versión más nueva del presupuesto que la usada por este EP?
  const latestBudgetVersion = await prisma.budgetVersion.findFirst({
    where: { projectId, type: "obra" },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true },
  });
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
      />
    </div>
  );
}
