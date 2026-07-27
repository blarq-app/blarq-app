import type { PrismaClient } from "@prisma/client";
import { selectVigente } from "@/lib/projects/selectVersion";

// Acumuladores de EPs cerrados anteriores, indexados por lineageId.
// La fuente de verdad es lineageId (no obraItemId), porque obraItemId rota
// cuando el presupuesto cambia de versión.
//
// Usado por: EP creation (herencia de avance), close (snapshot de amountPaid),
// pdf (cálculo de incrementales), sync (detección de outOfScope con pagos).
export async function buildPrevAccumulators(
  prisma: PrismaClient,
  opts: { projectId: string; beforeNumber?: number; maestroId?: string | null }
): Promise<{
  prevExecutedByLineage: Map<string, number>;
  prevAmountPaidByLineage: Map<string, number>;
}> {
  // Los acumuladores se scopean por maestro cuando la obra está repartida:
  // cada maestro lleva su propia serie de EPs, así que su avance anterior solo
  // suma los EPs cerrados DE ESE maestro. Si maestroId no viene (undefined),
  // no se filtra por maestro (comportamiento legacy: EPs de obra completa).
  const where = {
    projectId: opts.projectId,
    status: "cerrado",
    ...(opts.maestroId !== undefined ? { maestroId: opts.maestroId } : {}),
    ...(opts.beforeNumber !== undefined
      ? { number: { lt: opts.beforeNumber } }
      : {}),
  };
  const prevClosedEps = await prisma.estadoPago.findMany({
    where,
    include: { items: true },
  });

  const prevExecutedByLineage = new Map<string, number>();
  const prevAmountPaidByLineage = new Map<string, number>();
  for (const prev of prevClosedEps) {
    for (const it of prev.items) {
      prevExecutedByLineage.set(
        it.lineageId,
        Math.max(
          prevExecutedByLineage.get(it.lineageId) ?? 0,
          it.quantityExecuted
        )
      );
      prevAmountPaidByLineage.set(
        it.lineageId,
        (prevAmountPaidByLineage.get(it.lineageId) ?? 0) + (it.amountPaid ?? 0)
      );
    }
  }
  return { prevExecutedByLineage, prevAmountPaidByLineage };
}

// Devuelve la versión de obra VIGENTE del proyecto, con sus obraItems ordenados
// por sortOrder. Usa el criterio ÚNICO de selectVersion.ts (la última
// enviada/aprobada; si solo hay borradores, el más reciente) — el mismo que el
// Resumen/Fondo, para que el mundo de los EPs y el del Resumen nunca miren
// versiones distintas. Antes acá había un criterio propio ("la aprobada gana")
// que divergía del Resumen.
//
// Es el DEFAULT: al crear un EP, MJ puede elegir otra versión a mano (el EP
// guarda su budgetVersionId), pero si no elige, se usa esta.
export async function findLatestObraBudget(
  prisma: PrismaClient,
  projectId: string
) {
  const versions = await prisma.budgetVersion.findMany({
    where: { projectId, type: "obra" },
    select: { id: true, status: true, createdAt: true },
  });
  const vigente = selectVigente(versions);
  if (!vigente) return null;
  return prisma.budgetVersion.findUnique({
    where: { id: vigente.id },
    include: {
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}
