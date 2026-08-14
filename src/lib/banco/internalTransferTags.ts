// Etiquetado de un traspaso interno (Operativa → Sueldos) con obra y concepto.
//
// Una transferencia interna son DOS movimientos linkeados: sale −X de
// Operativa y entra +X a Sueldos. La obra y el concepto se ponen en LOS DOS
// lados a la vez, para que quede conciliada sin importar en cuál fila se hizo
// el gesto. El cálculo de "transferido por obra" suma SOLO el lado que entra a
// Sueldos (ver fondoSueldos.ts y la vista de resumen del proyecto), así que
// etiquetar ambos lados no produce doble conteo.
//
// Esta lógica vivía inline en el PATCH de /api/banco/movimientos/[id],
// duplicada dos veces (una para la obra, otra para el concepto). Se extrajo
// acá cuando el bot de Telegram pasó a ser un segundo camino para etiquetar lo
// mismo: dos caminos que escriben el mismo dato tienen que compartir la regla,
// si no se van separando con el tiempo.

import { prisma } from "@/lib/prisma";

/** Los dos conceptos válidos de un traspaso. Un movimiento es uno u otro. */
export const CONCEPTOS_TRASPASO = ["obra", "muebles"] as const;
export type ConceptoTraspaso = (typeof CONCEPTOS_TRASPASO)[number];

export function esConceptoValido(v: string): v is ConceptoTraspaso {
  return (CONCEPTOS_TRASPASO as readonly string[]).includes(v);
}

/**
 * ¿Este movimiento es un traspaso interno entre cuentas BLARQ?
 * Se acepta por cualquiera de las dos marcas porque conviven: el import pone
 * las dos, pero hay datos viejos marcados solo por status.
 */
export function esTraspasoInterno(mov: {
  category: string | null;
  status: string;
}): boolean {
  return mov.category === "transfer_interno" || mov.status === "interno";
}

/**
 * Devuelve los ids de LOS DOS lados del par (incluido el propio movimiento).
 *
 * La relación internalTransferToId se setea en los dos sentidos al importar,
 * pero por si algún dato viejo solo tiene un lado, se busca también el
 * movimiento que apunta a este.
 */
export async function idsDelPar(mov: {
  id: string;
  internalTransferToId: string | null;
}): Promise<string[]> {
  const ids = new Set<string>([mov.id]);
  if (mov.internalTransferToId) ids.add(mov.internalTransferToId);
  const back = await prisma.bankMovement.findFirst({
    where: { internalTransferToId: mov.id },
    select: { id: true },
  });
  if (back) ids.add(back.id);
  return Array.from(ids);
}

/**
 * Escribe obra y/o concepto en los dos lados del par. Solo toca los campos
 * que se pasan (undefined = no tocar; null = borrar).
 *
 * Devuelve cuántos movimientos quedaron etiquetados (normalmente 2).
 */
export async function etiquetarTraspaso(
  mov: { id: string; internalTransferToId: string | null },
  data: { projectId?: string | null; internalConcepto?: string | null }
): Promise<number> {
  const ids = await idsDelPar(mov);
  const r = await prisma.bankMovement.updateMany({
    where: { id: { in: ids } },
    data,
  });
  return r.count;
}
