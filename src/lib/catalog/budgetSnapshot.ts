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
 * (el caso real de drift) y para ARTEFACTOS (desde 2026-06-18, junto con la
 * propagación de precios catálogo→cotización). La foto igual captura muebles
 * para que el registro quede completo, pero restaurar muebles todavía no.
 */

import { prisma } from "@/lib/prisma";

// Campos de ObraItem que viajan en la foto (todo lo que define la partida).
//
// `maestroId` y `noCobrado` se agregaron el 2026-09-04: antes no viajaban, y
// como el restore BORRA y RECREA las partidas, "volver a lo enviado" se
// llevaba puesta la asignación de maestros y la marca de plata absorbida.
// Pasó de verdad en la V3 de Paseo del Sena (54 maestros perdidos de un
// click). Las dos definen la partida: a quién se le paga, y si se le cobra
// al cliente — no son marcas de trabajo.
//
// `revisado` NO viaja a propósito: es una marca interna de "esto ya lo
// miramos", no parte de lo que se le mandó al cliente. Igual sobrevive al
// restore, porque se preserva de la partida actual (ver `previos` abajo).
function pickObraItem(it: {
  lineageId: string; chapterName: string; subChapter: string | null;
  itemNumber: string; name: string; descriptionCliente: string | null;
  descriptionMaestro: string | null; unit: string; quantity: number;
  unitPrice: number; total: number; costMaterial: number | null;
  costLabor: number | null; costSubcontract: number | null;
  costMargin: number | null; costTools: number | null; costLoss: number | null;
  sortOrder: number; catalogPartidaId: string | null; isCustomized: boolean;
  maestroId: string | null; noCobrado: boolean;
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
      obraChapters: { orderBy: { sortOrder: "asc" } },
      muebleItems: true,
      artefactoItems: true,
    },
  });
  if (!bv) throw new Error("Versión no encontrada");

  // La foto guarda el NOMBRE del capítulo de cada partida, no su id: al
  // restaurar, los capítulos pueden haberse renombrado o borrado, y un id
  // apuntando a nada dejaría la partida huérfana. Con el nombre se resuelve
  // (o se recrea) el capítulo al restaurar.
  const nombreCapitulo = new Map(bv.obraChapters.map((c) => [c.id, c.name]));

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
      lineageId: it.lineageId,
      chapterName: it.chapterId ? nombreCapitulo.get(it.chapterId) ?? "" : "",
      subChapter: it.subChapter,
      itemNumber: it.itemNumber, name: it.name,
      descriptionCliente: it.descriptionCliente, descriptionMaestro: it.descriptionMaestro,
      unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total,
      costMaterial: it.costMaterial, costLabor: it.costLabor,
      costSubcontract: it.costSubcontract, costMargin: it.costMargin,
      costTools: it.costTools, costLoss: it.costLoss,
      sortOrder: it.sortOrder, catalogPartidaId: it.catalogPartidaId,
      isCustomized: it.isCustomized,
      maestroId: it.maestroId, noCobrado: it.noCobrado,
      components,
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

  // Una foto guardada NO es necesariamente del formato de hoy: las anteriores
  // al 2026-09-04 no traen `maestroId` ni `noCobrado`. El tipo lo dice para
  // que el código esté obligado a contemplar que falten.
  type SnapGuardado = Omit<Awaited<ReturnType<typeof buildBudgetSnapshot>>, "obraItems"> & {
    obraItems: (Omit<
      Awaited<ReturnType<typeof buildBudgetSnapshot>>["obraItems"][number],
      "maestroId" | "noCobrado"
    > & { maestroId?: string | null; noCobrado?: boolean })[];
  };
  const snap = bv.sentSnapshot as unknown as SnapGuardado;

  await prisma.$transaction(async (tx) => {
    // ANTES de borrar, guardarse el maestro y las dos marcas de cada partida,
    // indexados por lineageId. Sirven para dos cosas:
    //
    //   · `revisado` no viaja en la foto a propósito (es marca de trabajo, no
    //     parte de lo enviado) y se preserva siempre desde acá.
    //   · las fotos sacadas ANTES del 2026-09-04 no traen `maestroId` ni
    //     `noCobrado`. Para esas, se preserva lo que la partida tiene hoy en
    //     vez de dejarlo en blanco. Sin este respaldo, restaurar cualquier
    //     foto vieja seguiría borrando los maestros — que es justamente el
    //     problema que se está arreglando, y hoy casi todas las fotos
    //     guardadas son viejas.
    //
    // Cuando la foto SÍ trae el dato, gana la foto: es lo que se envió.
    const previos = new Map(
      (
        await tx.obraItem.findMany({
          where: { budgetVersionId: versionId },
          select: { lineageId: true, maestroId: true, noCobrado: true, revisado: true },
        })
      ).map((i) => [i.lineageId, i])
    );

    // Borrar partidas actuales (cascade borra sus componentes).
    await tx.obraItem.deleteMany({ where: { budgetVersionId: versionId } });

    // Resolver el capítulo de cada partida POR NOMBRE. Si el capítulo se
    // renombró o se borró después de enviar, se recrea al final del orden —
    // así ninguna partida de la foto vuelve sin capítulo.
    const existentes = await tx.obraChapter.findMany({
      where: { budgetVersionId: versionId },
      orderBy: { sortOrder: "asc" },
    });
    const porNombre = new Map(
      existentes.map((c) => [c.name.trim().toUpperCase(), c.id])
    );
    let proximoOrden = existentes.length;
    async function resolverCapitulo(nombre: string): Promise<string | null> {
      const clave = nombre.trim().toUpperCase();
      if (!clave) return null;
      const ya = porNombre.get(clave);
      if (ya) return ya;
      const creado = await tx.obraChapter.create({
        data: {
          budgetVersionId: versionId,
          name: nombre.trim(),
          sortOrder: proximoOrden++,
        },
      });
      porNombre.set(clave, creado.id);
      return creado.id;
    }

    for (const it of snap.obraItems) {
      const chapterId = await resolverCapitulo(it.chapterName ?? "");
      const previo = previos.get(it.lineageId);
      // `?? previo` y no `||`: un maestroId null de una foto NUEVA es una
      // decisión ("esta partida no tiene maestro") y debe respetarse. Lo que
      // cae al previo es el `undefined` de las fotos viejas, que no opinaron.
      const maestroId = it.maestroId !== undefined ? it.maestroId : (previo?.maestroId ?? null);
      const noCobrado = it.noCobrado !== undefined ? it.noCobrado : (previo?.noCobrado ?? false);
      const created = await tx.obraItem.create({
        data: {
          budgetVersionId: versionId,
          lineageId: it.lineageId,
          chapterId,
          chapter: "", // legacy, ver nota en schema.prisma
          subChapter: it.subChapter,
          itemNumber: it.itemNumber, name: it.name,
          descriptionCliente: it.descriptionCliente, descriptionMaestro: it.descriptionMaestro,
          unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total,
          costMaterial: it.costMaterial, costLabor: it.costLabor,
          costSubcontract: it.costSubcontract, costMargin: it.costMargin,
          costTools: it.costTools, costLoss: it.costLoss,
          sortOrder: it.sortOrder, catalogPartidaId: it.catalogPartidaId,
          isCustomized: it.isCustomized,
          maestroId, noCobrado,
          // La marca de revisión no es parte de lo enviado: sobrevive tal
          // cual estaba, no se restaura desde la foto.
          revisado: previo?.revisado ?? false,
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

// Campos de un ArtefactoItem tal como viajan en la foto. La foto guarda las
// filas crudas (bv.artefactoItems), así que al leerlas de JSON son objetos
// planos; tomamos solo lo que define la línea (sin id / budgetVersionId, que
// se regeneran al recrear).
interface ArtefactoSnap {
  room: string; subcategory: string; name: string; detail: string | null;
  brand: string | null; quantity: number; listPrice: number;
  discountPercent: number | null; clientPrice: number;
  realCostBlarq: number | null; referenceLink: string | null;
  imageUrl: string | null; catalogId: string | null;
  priceOverridden?: boolean; sortOrder: number;
}

/**
 * Restaura una versión de ARTEFACTOS a su foto: borra las líneas actuales y
 * las recrea exactamente como estaban al enviar. No toca el estado ni la foto.
 * Caso de uso: MJ editó a mano una cotización enviada y quiere dejarla igual
 * que como se la mandó al cliente.
 */
export async function restoreArtefactosFromSnapshot(versionId: string) {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: versionId },
    select: { sentSnapshot: true, type: true },
  });
  if (!bv) throw new Error("Versión no encontrada");
  if (!bv.sentSnapshot) throw new Error("Esta versión no tiene foto guardada (nunca se envió)");
  if (bv.type !== "artefactos") throw new Error("Tipo de versión no es artefactos");

  const snap = bv.sentSnapshot as unknown as { artefactoItems?: ArtefactoSnap[] };
  const items = snap.artefactoItems ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.artefactoItem.deleteMany({ where: { budgetVersionId: versionId } });
    for (const it of items) {
      await tx.artefactoItem.create({
        data: {
          budgetVersionId: versionId,
          room: it.room, subcategory: it.subcategory, name: it.name,
          detail: it.detail, brand: it.brand, quantity: it.quantity,
          listPrice: it.listPrice, discountPercent: it.discountPercent,
          clientPrice: it.clientPrice, realCostBlarq: it.realCostBlarq,
          referenceLink: it.referenceLink, imageUrl: it.imageUrl,
          catalogId: it.catalogId,
          // Fotos viejas (anteriores al 2026-06-18) no tienen el flag → false.
          priceOverridden: it.priceOverridden ?? false,
          sortOrder: it.sortOrder,
        },
      });
    }
  }, { timeout: 120000, maxWait: 20000 });

  return { restoredItems: items.length };
}
