/**
 * Comparación entre versiones de un presupuesto de OBRA — marca, partida por
 * partida, qué cambió respecto a lo que el cliente vio la última vez.
 *
 * Decidido con MJ (sesión diseño 2026-06-10):
 *   - Se compara el TOTAL de la partida (lo que el cliente paga por esa línea).
 *   - Base de comparación: la ÚLTIMA versión ENVIADA al cliente anterior a la
 *     actual (su foto inmutable `sentSnapshot`). Si no hay foto contra la cual
 *     comparar (ej. la V1, o versiones viejas sin foto), no se marca nada.
 *   - El emparejamiento vieja ↔ nueva usa el `lineageId` (DNI estable de la
 *     partida, se preserva al duplicar la versión), no el nombre ni el id.
 *   - Marcas: "added" (NUEVO, no existía antes), "up" (subió el total),
 *     "down" (bajó el total). Sin cambio o cambio < tolerancia → null.
 *
 * La marca NO se guarda en base: se calcula al vuelo cada vez que se abre el
 * editor o se imprime el PDF, así nunca queda desactualizada.
 */

import { prisma } from "@/lib/prisma";

export type ChangeMarker = "added" | "up" | "down" | null;

export interface DiffItemInput {
  lineageId: string;
  total: number;
}

export interface BaselineItem {
  lineageId: string;
  total: number;
}

export interface ChangeResult {
  marker: ChangeMarker;
  // Total de la partida en la versión base (lo que el cliente vio). Null si
  // la partida es nueva o no hay base. Sirve para el detalle "antes → ahora"
  // en el editor.
  prevTotal: number | null;
}

// Tolerancia en pesos: ignora diferencias de redondeo para no pintar una
// flecha por $0,5.
const TOLERANCE = 1;

/**
 * Calcula la marca de cambio de cada partida actual contra la base.
 * Devuelve un mapa lineageId -> { marker, prevTotal }.
 * Si `baselineItems` es null (no hay versión base), todas las marcas son null.
 */
export function computeChangeMarkers(
  currentItems: DiffItemInput[],
  baselineItems: BaselineItem[] | null
): Map<string, ChangeResult> {
  const result = new Map<string, ChangeResult>();

  if (!baselineItems) {
    for (const it of currentItems) {
      result.set(it.lineageId, { marker: null, prevTotal: null });
    }
    return result;
  }

  const prevByLineage = new Map<string, number>();
  for (const b of baselineItems) prevByLineage.set(b.lineageId, b.total);

  for (const it of currentItems) {
    const prev = prevByLineage.get(it.lineageId);
    if (prev === undefined) {
      result.set(it.lineageId, { marker: "added", prevTotal: null });
    } else if (it.total > prev + TOLERANCE) {
      result.set(it.lineageId, { marker: "up", prevTotal: prev });
    } else if (it.total < prev - TOLERANCE) {
      result.set(it.lineageId, { marker: "down", prevTotal: prev });
    } else {
      result.set(it.lineageId, { marker: null, prevTotal: prev });
    }
  }

  return result;
}

function parseVersionNum(v: string): number {
  const m = v.match(/^V(\d+)$/i);
  return m ? parseInt(m[1], 10) : NaN;
}

interface ObraSnapshotShape {
  obraItems?: { lineageId: string; total: number }[];
}

/**
 * Carga los items de la foto de la última versión ENVIADA al cliente que sea
 * anterior a `current`. Devuelve sus partidas (lineageId + total) o null si no
 * hay base contra la cual comparar.
 *
 * "Anterior a current" se decide por número de versión (V1 < V2 < V3) cuando
 * se puede parsear; si no, por fecha de envío. Solo se consideran versiones
 * que tengan foto (`sentSnapshot`) y fecha de envío (`sentAt`).
 */
export async function getObraBaselineItems(current: {
  id: string;
  projectId: string;
  type: string;
  version: string;
}): Promise<BaselineItem[] | null> {
  if (current.type !== "obra") return null;

  const candidates = await prisma.budgetVersion.findMany({
    where: { projectId: current.projectId, type: "obra", id: { not: current.id } },
    select: { id: true, version: true, sentAt: true, sentSnapshot: true },
  });

  const curNum = parseVersionNum(current.version);

  // Solo versiones con foto y enviadas, y que sean anteriores a la actual.
  const earlier = candidates.filter((c) => {
    if (!c.sentSnapshot || !c.sentAt) return false;
    const n = parseVersionNum(c.version);
    if (!isNaN(curNum) && !isNaN(n)) return n < curNum;
    // Si alguno no parsea como Vn, no lo descartamos acá; se ordena por sentAt.
    return true;
  });

  if (earlier.length === 0) return null;

  // La "última enviada anterior": mayor número de versión; empate o sin
  // número → la de fecha de envío más reciente.
  earlier.sort((a, b) => {
    const na = parseVersionNum(a.version);
    const nb = parseVersionNum(b.version);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return nb - na;
    return (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0);
  });

  const snap = earlier[0].sentSnapshot as unknown as ObraSnapshotShape;
  if (!snap?.obraItems) return null;

  return snap.obraItems.map((it) => ({
    lineageId: it.lineageId,
    total: it.total,
  }));
}
