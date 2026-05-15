/**
 * Regla MJ 2026-05-15: una partida que ya viajó al cliente en una versión
 * enviada o aprobada queda blindada contractualmente. Aunque después se
 * abra una V2 en borrador (por ejemplo, para agregar partidas nuevas), las
 * partidas heredadas de V1 NO se sincronizan con cambios al catálogo —
 * porque eso significaría cambiarle el costo al cliente "por actualización"
 * sin que él lo sepa. Solo MJ puede modificar esas partidas a mano y
 * comunicar el cambio al cliente.
 *
 * Las partidas NUEVAS de V2 (que no existían en V1) sí se pueden
 * sincronizar — el cliente nunca recibió un valor anterior para esa.
 *
 * Identificación: `ObraItem.lineageId` se preserva al duplicar la versión.
 * Si ese lineageId aparece en una versión enviada/aprobada del mismo
 * proyecto+tipo, está congelado.
 */

import { prisma } from "@/lib/prisma";

const cache = new Map<string, Set<string>>();

function keyOf(projectId: string, type: string) {
  return `${projectId}|${type}`;
}

/**
 * Devuelve el set de `lineageId` que están congelados para un proyecto+tipo
 * dado. Resultado cacheado durante la vida del proceso — útil en loops.
 * Para invalidar el cache (ej: tests), llamar a `clearFrozenLineageCache()`.
 */
export async function getFrozenLineageIds(
  projectId: string,
  type: string
): Promise<Set<string>> {
  const key = keyOf(projectId, type);
  const cached = cache.get(key);
  if (cached) return cached;

  const rows = await prisma.obraItem.findMany({
    where: {
      budgetVersion: {
        projectId,
        type,
        status: { in: ["enviado", "aprobado"] },
      },
    },
    select: { lineageId: true },
    distinct: ["lineageId"],
  });
  const set = new Set(rows.map((r) => r.lineageId));
  cache.set(key, set);
  return set;
}

export function clearFrozenLineageCache() {
  cache.clear();
}
