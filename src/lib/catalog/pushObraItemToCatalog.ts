/**
 * Sube líneas del desglose de una partida de la cotización (ObraItemComponent)
 * a la partida equivalente del catálogo (PartidaComponent). Es la dirección
 * inversa al sync normal (catálogo → borradores): acá MJ decide "guardá lo que
 * edité en esta cotización también en el catálogo, para la próxima vez".
 *
 * Dos usos:
 *   - Botón "↑" por línea (ObraItemComponentsEditor): sube UNA línea.
 *   - Botón "↑ Precios a catálogo + borradores" (PartidaExpandedPanel): sube el
 *     desglose COMPLETO de la partida.
 *
 * Por qué un helper compartido y no copiar campo por campo en cada endpoint:
 * la PÉRDIDA es un "% sobre un material concreto" (appliedToComponentId apunta
 * a OTRA línea). Ese puntero usa ids de la cotización, que NO existen en el
 * catálogo. Si no se traduce, la pérdida llega al catálogo apuntando a la nada
 * y se calcula en $0 (era el bug). Acá traducimos el puntero usando el vínculo
 * originComponentId (cada línea de la cotización recuerda de qué línea del
 * catálogo vino), y procesamos primero los materiales para que cuando toque la
 * pérdida su material destino ya exista en el catálogo.
 *
 * Anti-duplicado: una línea de la cotización puede no tener vínculo al catálogo
 * (la creó MJ a mano, o se sembró desde los montos globales, o es data vieja
 * anterior al 2026-05-15). Para no crear una línea repetida en el catálogo,
 * antes de crear buscamos una línea equivalente ya existente (por materialId si
 * es material, o por tipo+descripción si no) y, si la hay, la actualizamos y
 * adoptamos el vínculo. Así subir dos veces NO duplica ni infla el total.
 */

import { prisma } from "@/lib/prisma";
import type { ObraItemComponent, PartidaComponent } from "@prisma/client";
import { recalcPartidaTotals } from "@/lib/catalog/recalcPartida";

// Error tipado para que el endpoint responda 400 con un mensaje claro cuando la
// partida de la cotización no está vinculada a ninguna partida del catálogo.
export class SinCatalogoError extends Error {
  constructor() {
    super(
      "Esta partida no está vinculada al catálogo. Guardá primero la partida en el catálogo para poder subirle el desglose."
    );
    this.name = "SinCatalogoError";
  }
}

// Campos que viajan al catálogo. NO copiamos isCustomized (es propio de la
// cotización) ni appliedToComponentId crudo (se traduce aparte más abajo).
function payloadFrom(comp: ObraItemComponent) {
  return {
    type: comp.type,
    description: comp.description,
    unit: comp.unit,
    quantity: comp.quantity,
    unitCost: comp.unitCost,
    totalCost: comp.totalCost,
    materialId: comp.materialId,
    referenceLink: comp.referenceLink,
    appliedToType: comp.appliedToType,
  };
}

/**
 * Sube componentes de un ObraItem al catálogo.
 *
 * @param itemId  ObraItem de la cotización.
 * @param only    ids de ObraItemComponent a subir. Si se omite, sube TODOS.
 *                Si se pasan algunos y alguno es una pérdida % sobre un material,
 *                ese material se incluye automáticamente (sin él la pérdida no
 *                se puede calcular en el catálogo).
 * @returns       cantidad de líneas subidas (creadas o actualizadas).
 */
export async function pushObraItemComponentsToCatalog(
  itemId: string,
  only?: string[]
): Promise<{ pushed: number; catalogPartidaId: string }> {
  const item = await prisma.obraItem.findUnique({
    where: { id: itemId },
    select: { catalogPartidaId: true },
  });
  const catalogPartidaId = item?.catalogPartidaId;
  if (!catalogPartidaId) throw new SinCatalogoError();

  // Todos los componentes de la cotización (los necesito enteros para resolver
  // el material destino de una pérdida aunque no esté en el set a subir).
  const allComps = await prisma.obraItemComponent.findMany({
    where: { obraItemId: itemId },
  });
  const byId = new Map(allComps.map((c) => [c.id, c]));

  // Set de ids a subir.
  let toPushIds: Set<string>;
  if (only && only.length > 0) {
    toPushIds = new Set(only);
    // Asegurar que el material destino de cada pérdida % también suba: sin él
    // el puntero quedaría colgando y la pérdida se calcularía en $0.
    for (const id of [...toPushIds]) {
      const c = byId.get(id);
      if (c?.type === "perdida" && c.unit === "%" && c.appliedToComponentId) {
        if (byId.has(c.appliedToComponentId)) toPushIds.add(c.appliedToComponentId);
      }
    }
  } else {
    toPushIds = new Set(allComps.map((c) => c.id));
  }

  // Orden de proceso: primero todo lo que NO es pérdida, después las pérdidas.
  // Así, cuando subo una pérdida, su material destino ya está en el catálogo y
  // tengo su id para traducir el puntero.
  const toPush = allComps
    .filter((c) => toPushIds.has(c.id))
    .sort(
      (a, b) =>
        (a.type === "perdida" ? 1 : 0) - (b.type === "perdida" ? 1 : 0) ||
        a.sortOrder - b.sortOrder
    );

  // Líneas que ya existen en el catálogo de esta partida (para upsert por
  // vínculo o por equivalencia, y para no duplicar).
  const catalogComps = await prisma.partidaComponent.findMany({
    where: { partidaId: catalogPartidaId },
  });
  const catalogById = new Map(catalogComps.map((c) => [c.id, c]));

  // Mapa cotizaciónCompId → catalogCompId, para traducir appliedToComponentId.
  const originMap = new Map<string, string>();
  // Pre-cargar los vínculos ya existentes y vivos (un material destino que ya
  // se subió en una corrida previa queda resuelto sin re-subirlo).
  for (const c of allComps) {
    if (c.originComponentId && catalogById.has(c.originComponentId)) {
      originMap.set(c.id, c.originComponentId);
    }
  }

  // Ids de catálogo ya "tomados" en esta corrida, para que dos líneas de la
  // cotización no caigan sobre la misma línea del catálogo por el match laxo.
  const claimed = new Set<string>();

  // Próximo sortOrder para líneas nuevas en el catálogo.
  let nextSort =
    catalogComps.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

  // Busca una línea del catálogo equivalente cuando NO hay vínculo directo.
  // Material → por materialId (fuerte). Resto → por tipo + descripción (igual,
  // sin espacios). Evita las ya tomadas en esta corrida.
  function matchExisting(comp: ObraItemComponent): PartidaComponent | null {
    const candidates = catalogComps.filter((cc) => !claimed.has(cc.id));
    if (comp.materialId) {
      return (
        candidates.find(
          (cc) => cc.type === "material" && cc.materialId === comp.materialId
        ) ?? null
      );
    }
    const norm = (s: string) => s.trim().toLowerCase();
    return (
      candidates.find(
        (cc) => cc.type === comp.type && norm(cc.description) === norm(comp.description)
      ) ?? null
    );
  }

  let pushed = 0;

  for (const comp of toPush) {
    const data: Record<string, unknown> = payloadFrom(comp);

    // Traducir el puntero de la pérdida al id del material EN EL CATÁLOGO.
    if (comp.type === "perdida" && comp.unit === "%" && comp.appliedToComponentId) {
      data.appliedToComponentId = originMap.get(comp.appliedToComponentId) ?? null;
    } else {
      // Para el resto, el puntero por-id no aplica (margen/leyes usan
      // appliedToType, no un id). Lo dejamos null para no arrastrar un id de la
      // cotización al catálogo.
      data.appliedToComponentId = null;
    }

    // ¿Sobre qué línea del catálogo aplicamos? 1) vínculo vivo, 2) equivalente
    // existente (adoptamos el vínculo), 3) crear nueva.
    let targetId: string | null = null;
    if (comp.originComponentId && catalogById.has(comp.originComponentId)) {
      targetId = comp.originComponentId;
    } else {
      const match = matchExisting(comp);
      if (match) {
        targetId = match.id;
        // Adoptar el vínculo para que el sync futuro lo reconozca.
        await prisma.obraItemComponent.update({
          where: { id: comp.id },
          data: { originComponentId: match.id },
        });
      }
    }

    if (targetId) {
      await prisma.partidaComponent.update({ where: { id: targetId }, data });
      claimed.add(targetId);
      originMap.set(comp.id, targetId);
    } else {
      const created = await prisma.partidaComponent.create({
        data: {
          partidaId: catalogPartidaId,
          sortOrder: nextSort++,
          ...(data as object),
        } as never,
      });
      catalogById.set(created.id, created);
      catalogComps.push(created);
      claimed.add(created.id);
      originMap.set(comp.id, created.id);
      // Dejar el vínculo en la cotización para el sync diferencial futuro.
      await prisma.obraItemComponent.update({
        where: { id: comp.id },
        data: { originComponentId: created.id },
      });
    }
    pushed++;
  }

  // Recalcula unitPrice + cost* de la partida del catálogo desde sus líneas
  // (incluida la pérdida recién traducida, que ahora SÍ se calcula bien).
  await recalcPartidaTotals(catalogPartidaId);

  return { pushed, catalogPartidaId };
}
