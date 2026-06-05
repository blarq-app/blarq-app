/**
 * Foto (snapshot) de una versión de presupuesto al enviarla/cerrarla.
 *
 * Concepto (tarea 9, decidido con MJ 2026-06-04): cuando una versión se
 * envía al cliente, se le saca una FOTO inmutable de todo su contenido
 * (partidas + desglose + totales) y queda DESLIGADA del catálogo — el sync
 * automático nunca la vuelve a tocar (eso ya lo garantiza `frozenLineage` +
 * que el sync solo corre sobre borradores). La foto sirve para:
 *   1) registro de "esto fue lo que se le mandó al cliente el día X",
 *   2) "volver a lo enviado": deshacer ediciones manuales hacia la foto.
 *
 * Una versión enviada SÍ se puede editar a mano (no se reconecta al
 * catálogo); la foto no cambia hasta que se vuelve a enviar.
 *
 * Alcance: la restauración está implementada para presupuestos de OBRA
 * (el caso real de drift). La foto igual captura muebles/artefactos para
 * que el registro quede completo, pero restaurar esos tipos todavía no.
 */

import { prisma } from "@/lib/prisma";

// Campos de ObraItem que viajan en la foto (todo lo que define la partida).
function pickObraItem(it: {
  lineageId: string; chapter: string; subChapter: string | null;
  itemNumber: string; name: string; descriptionCliente: string | null;
  descriptionMaestro: string | null; unit: string; quantity: number;
  unitPrice: number; total: number; costMaterial: number | null;
  costLabor: number | null; costSubcontract: number | null;
  costMargin: number | null; costTools: number | null; costLoss: number | null;
  sortOrder: number; catalogPartidaId: string | null; isCustomized: boolean;
  components: ComponentSnap[];
}) {
  return { ...it };
}

interface ComponentSnap {
  // `localId` identifica el componente DENTRO de la foto, para poder
  // re-vincular la pérdida a su material al restaurar (los ids reales de
  // base cambian al recrear).
  localId: string;
  type: string; description: string; unit: string; quantity: number;
  unitCost: number; totalCost: number; referenceLink: string | null;
  materialId: string | null; originComponentId: string | null;
  isCustomized: boolean; sortOrder: number;
  appliedToLocalId: string | null; // apunta a otro localId (material) para la pérdida
  appliedToType: string | null;
}

/**
 * Construye la foto de una versión: devuelve un objeto JSON-serializable
 * con los campos de la versión + sus partidas (obra) y desglose.
 */
export async function buildBudgetSnapshot(versionId: string) {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: versionId },
    include: {
      obraItems: {
        orderBy: { sortOrder: "asc" },
        include: { components: { orderBy: { sortOrder: "asc" } } },
      },
      muebleItems: true,
      artefactoItems: true,
    },
  });
  if (!bv) throw new Error("Versión no encontrada");

  const obraItems = bv.obraItems.map((it) => {
    // map de id real -> localId para re-vincular pérdidas
    const idToLocal = new Map(it.components.map((c, i) => [c.id, `c${i}`]));
    const components: ComponentSnap[] = it.components.map((c, i) => ({
      localId: `c${i}`,
      type: c.type, description: c.description, unit: c.unit,
      quantity: c.quantity, unitCost: c.unitCost, totalCost: c.totalCost,
      referenceLink: c.referenceLink, materialId: c.materialId,
      originComponentId: c.originComponentId, isCustomized: c.isCustomized,
      sortOrder: c.sortOrder,
      appliedToLocalId: c.appliedToComponentId
        ? idToLocal.get(c.appliedToComponentId) ?? null
        : null,
      appliedToType: c.appliedToType,
    }));
    return pickObraItem({
      lineageId: it.lineageId, chapter: it.chapter, subChapter: it.subChapter,
      itemNumber: it.itemNumber, name: it.name,
      descriptionCliente: it.descriptionCliente, descriptionMaestro: it.descriptionMaestro,
      unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total,
      costMaterial: it.costMaterial, costLabor: it.costLabor,
      costSubcontract: it.costSubcontract, costMargin: it.costMargin,
      costTools: it.costTools, costLoss: it.costLoss,
      sortOrder: it.sortOrder, catalogPartidaId: it.catalogPartidaId,
      isCustomized: it.isCustomized, components,
    });
  });

  return {
    schema: 1,
    type: bv.type,
    ggPercentage: bv.ggPercentage,
    utilityPercentage: bv.utilityPercentage,
    discountPercentage: bv.discountPercentage,
    observations: bv.observations,
    obraItems,
    // Registro (sin restauración por ahora):
    muebleItems: bv.muebleItems,
    artefactoItems: bv.artefactoItems,
  };
}

/**
 * Restaura una versión de OBRA a su foto: borra las partidas actuales y las
 * recrea exactamente como en la foto (preservando lineageId y re-vinculando
 * la pérdida a su material). No toca el estado ni la foto.
 */
export async function restoreObraFromSnapshot(versionId: string) {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: versionId },
    select: { sentSnapshot: true, type: true },
  });
  if (!bv) throw new Error("Versión no encontrada");
  if (!bv.sentSnapshot) throw new Error("Esta versión no tiene foto guardada (nunca se envió)");
  if (bv.type !== "obra") throw new Error("Volver a lo enviado está implementado solo para obra");

  const snap = bv.sentSnapshot as unknown as Awaited<ReturnType<typeof buildBudgetSnapshot>>;

  await prisma.$transaction(async (tx) => {
    // Borrar partidas actuales (cascade borra sus componentes).
    await tx.obraItem.deleteMany({ where: { budgetVersionId: versionId } });

    for (const it of snap.obraItems) {
      const created = await tx.obraItem.create({
        data: {
          budgetVersionId: versionId,
          lineageId: it.lineageId, chapter: it.chapter, subChapter: it.subChapter,
          itemNumber: it.itemNumber, name: it.name,
          descriptionCliente: it.descriptionCliente, descriptionMaestro: it.descriptionMaestro,
          unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total,
          costMaterial: it.costMaterial, costLabor: it.costLabor,
          costSubcontract: it.costSubcontract, costMargin: it.costMargin,
          costTools: it.costTools, costLoss: it.costLoss,
          sortOrder: it.sortOrder, catalogPartidaId: it.catalogPartidaId,
          isCustomized: it.isCustomized,
        },
      });
      // Crear componentes; guardar localId -> id real para re-vincular pérdidas.
      const localToId = new Map<string, string>();
      for (const c of it.components) {
        const newC = await tx.obraItemComponent.create({
          data: {
            obraItemId: created.id,
            type: c.type, description: c.description, unit: c.unit,
            quantity: c.quantity, unitCost: c.unitCost, totalCost: c.totalCost,
            referenceLink: c.referenceLink, materialId: c.materialId,
            originComponentId: c.originComponentId, isCustomized: c.isCustomized,
            sortOrder: c.sortOrder, appliedToType: c.appliedToType,
            // appliedToComponentId se setea en una segunda pasada (necesita el id nuevo).
          },
        });
        localToId.set(c.localId, newC.id);
      }
      // Segunda pasada: re-vincular pérdidas a su material por localId.
      for (const c of it.components) {
        if (!c.appliedToLocalId) continue;
        const selfId = localToId.get(c.localId);
        const targetId = localToId.get(c.appliedToLocalId);
        if (selfId && targetId) {
          await tx.obraItemComponent.update({
            where: { id: selfId },
            data: { appliedToComponentId: targetId },
          });
        }
      }
    }

    // Restaurar campos de la versión.
    await tx.budgetVersion.update({
      where: { id: versionId },
      data: {
        ggPercentage: snap.ggPercentage,
        utilityPercentage: snap.utilityPercentage,
        discountPercentage: snap.discountPercentage,
        observations: snap.observations,
      },
    });
  }, { timeout: 120000, maxWait: 20000 });

  return { restoredItems: snap.obraItems.length };
}
