import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Crear nueva versión de presupuesto
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();

    if (!data.projectId || !data.type) {
      return NextResponse.json(
        { error: "projectId y type son requeridos" },
        { status: 400 }
      );
    }

    // Determinar versión automáticamente
    const existing = await prisma.budgetVersion.findMany({
      where: { projectId: data.projectId, type: data.type },
      orderBy: { createdAt: "desc" },
    });

    // Calcular versión correcta: max(V existentes) + 1
    const maxV = existing.reduce((max, b) => {
      const m = b.version.match(/^V(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    const version = `V${maxV + 1}`;

    // Computar baseId antes de crear: si se duplica desde otra versión, ese id
    // queda como parentVersionId para trazabilidad explícita del lineage de versiones.
    // EXCEPCIÓN: en modo plantilla (importar desde otro proyecto), no hay
    // lineage — la versión nueva nace de cero estructuralmente aunque copió
    // los nombres de partidas.
    //
    // baseId SOLO se setea si se pide explícitamente una versión base
    // (botón "Duplicar" o importar). El botón "+ Nueva" NO manda baseVersionId
    // → versión VACÍA. Antes caía a la última versión (existing[0]) y copiaba
    // todo, así que "Nueva" venía prellenada igual que "Duplicar" (bug).
    const isTemplateMode = !!data.resetQuantities;
    const baseId = data.baseVersionId || null;
    const parentForNew = isTemplateMode ? null : baseId;

    // Si se duplica/importa desde una versión base, heredar GG/Util de esa
    // versión a menos que el cliente mande valores explícitos. Antes usábamos
    // defaults (20/5) y al duplicar se perdían los porcentajes del original
    // — bug: V1 con 20/10 se duplicaba como V2 con 20/5 y los totales no
    // calzaban.
    let basePrev: { ggPercentage: number | null; utilityPercentage: number | null; discountPercentage: number | null } | null = null;
    if (baseId) {
      basePrev = await prisma.budgetVersion.findUnique({
        where: { id: baseId },
        select: { ggPercentage: true, utilityPercentage: true, discountPercentage: true },
      });
      if (!basePrev) return NextResponse.json({ error: "Versión base no encontrada" }, { status: 404 });
    }

    const budget = await prisma.budgetVersion.create({
      data: {
        projectId: data.projectId,
        version,
        type: data.type,
        status: "borrador",
        parentVersionId: parentForNew,
        observations: data.observations || null,
        ggPercentage: data.ggPercentage ?? basePrev?.ggPercentage ?? 20,
        utilityPercentage: data.utilityPercentage ?? basePrev?.utilityPercentage ?? 5,
        discountPercentage: data.discountPercentage ?? basePrev?.discountPercentage ?? 0,
      },
    });
    if (baseId) {
      const previousVersion = await prisma.budgetVersion.findUnique({ where: { id: baseId } });
      if (!previousVersion) return NextResponse.json({ error: "Versión base no encontrada" }, { status: 404 });

      if (data.type === "obra") {
        const items = await prisma.obraItem.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
          // Traemos también los componentes (el desglose por material/mano de
          // obra/etc.) para copiarlos a la versión nueva. Sin esto, la partida
          // duplicada quedaba con los montos globales pero el "Detalle de
          // materiales y costos" vacío (bug reportado en duplicados de obra).
          include: { components: { orderBy: { sortOrder: "asc" } } },
        });

        // Si se está usando como plantilla (importar desde otro proyecto),
        // queremos cantidades en 0 y precios refrescados del catálogo actual.
        // Usado por el flujo "Importar desde otro proyecto" — el "Duplicar"
        // normal sigue copiando todo tal cual.
        const isTemplateMode = !!data.resetQuantities;
        const refreshPrices = !!data.refreshFromCatalog;

        // Pre-cargar el catálogo (siempre que haya catalogPartidaId).
        // Usamos para 2 cosas:
        // - Refrescar precios (si refreshFromCatalog está activo)
        // - Fallback de descripciones si el source no tiene
        const partidaIds = items
          .filter((i) => i.catalogPartidaId)
          .map((i) => i.catalogPartidaId!);
        const partidasMap = new Map<string, typeof items[number] extends { catalogPartidaId: string | null } ? Awaited<ReturnType<typeof prisma.partidaCatalog.findUnique>> : never>();
        if (partidaIds.length > 0) {
          const partidas = await prisma.partidaCatalog.findMany({
            where: { id: { in: partidaIds } },
          });
          for (const p of partidas) partidasMap.set(p.id, p as never);
        }

        for (const item of items) {
          // Resolver fuente de precios: catálogo (si refresh) o snapshot
          const partida = item.catalogPartidaId ? partidasMap.get(item.catalogPartidaId) : null;
          const useCatalog = refreshPrices && partida;

          const unitPrice = useCatalog ? partida!.unitPrice : item.unitPrice;
          const costMaterial = useCatalog ? partida!.costMaterial : (item.costMaterial ?? 0);
          const costLabor = useCatalog ? partida!.costLabor : (item.costLabor ?? 0);
          const costSubcontract = useCatalog ? partida!.costSubcontract : (item.costSubcontract ?? 0);
          const costMargin = useCatalog ? partida!.costMargin : (item.costMargin ?? 0);
          const costTools = useCatalog ? partida!.costTools : (item.costTools ?? 0);
          const costLoss = useCatalog ? partida!.costLoss : (item.costLoss ?? 0);

          // Descripciones: priorizar las del source (lo más reciente que
          // MJ editó). Si el source no tiene, fallback al catálogo. Sin
          // este fallback los items importados venían sin descripción.
          const descriptionCliente =
            item.descriptionCliente ?? partida?.descriptionCliente ?? null;
          const descriptionMaestro =
            item.descriptionMaestro ?? partida?.descriptionMaestro ?? null;

          const quantity = isTemplateMode ? 0 : item.quantity;
          const total = quantity * unitPrice;

          const newItem = await prisma.obraItem.create({
            data: {
              budgetVersionId: budget.id,
              // En modo plantilla NO preservamos lineageId — el ítem importado
              // es un punto de partida nuevo, no una continuación de la línea
              // de versiones del proyecto fuente.
              lineageId: isTemplateMode ? undefined : item.lineageId,
              chapter: item.chapter,
              // En modo plantilla (importar desde otro proyecto) no tiene
              // sentido arrastrar el sub-chapter del proyecto fuente — son
              // zonas físicas distintas. En modo duplicar normal, sí.
              subChapter: isTemplateMode ? null : item.subChapter,
              itemNumber: item.itemNumber,
              name: item.name,
              descriptionCliente,
              descriptionMaestro,
              unit: item.unit,
              quantity,
              unitPrice,
              total,
              costMaterial,
              costLabor,
              costSubcontract,
              costMargin,
              costTools,
              costLoss,
              catalogPartidaId: item.catalogPartidaId,
              // En modo plantilla, isCustomized=false (estado limpio).
              isCustomized: isTemplateMode ? false : item.isCustomized,
              sortOrder: item.sortOrder,
            },
          });

          // Copiar el desglose (componentes) del ítem fuente. Sin esto la
          // partida duplicada quedaba con montos globales pero detalle vacío.
          // No lo hacemos cuando se refresca desde catálogo (importar desde
          // otro proyecto con precios nuevos): ahí los montos vienen del
          // catálogo y el desglose se rearma distinto — copiar el del source
          // dejaría componentes que no calzan con los montos refrescados.
          if (!useCatalog && item.components.length > 0) {
            // appliedToComponentId apunta a otro componente del MISMO ítem
            // (ej. "pérdida" sobre un material concreto). Al copiar hay que
            // remapear ese id viejo → el nuevo. Primero creamos todos, luego
            // seteamos los appliedTo con el mapa.
            const idMap = new Map<string, string>();
            for (const c of item.components) {
              const createdComp = await prisma.obraItemComponent.create({
                data: {
                  obraItemId: newItem.id,
                  type: c.type,
                  description: c.description,
                  unit: c.unit,
                  quantity: c.quantity,
                  unitCost: c.unitCost,
                  totalCost: c.totalCost,
                  referenceLink: c.referenceLink,
                  materialId: c.materialId,
                  originComponentId: c.originComponentId,
                  isCustomized: c.isCustomized,
                  sortOrder: c.sortOrder,
                  appliedToType: c.appliedToType,
                  // appliedToComponentId se setea en la 2da pasada (remap).
                },
              });
              idMap.set(c.id, createdComp.id);
            }
            for (const c of item.components) {
              if (!c.appliedToComponentId) continue;
              const remapped = idMap.get(c.appliedToComponentId);
              if (!remapped) continue;
              await prisma.obraItemComponent.update({
                where: { id: idMap.get(c.id)! },
                data: { appliedToComponentId: remapped },
              });
            }
          }
        }
      }

      if (data.type === "muebles") {
        // En modo plantilla (importar desde otro proyecto):
        // - Mantenemos chapters + estructura de items (Mueble, Herrajes,
        //   Cubierta, etc) + supplier (Carlos, Giacomo, etc — son fijos).
        // - Mantenemos descriptionGeneral del item y la lista de details
        //   con su materialidad — es información estructural del mueble
        //   (qué lleva adentro, qué materiales), no específica del proyecto.
        // - Reseteamos precios y cantidades — son específicos del proyecto.
        // - NO copiamos quotes (cotizaciones alternativas) — son del
        //   contexto histórico del proyecto fuente.
        // En modo duplicar normal, copia todo tal cual.
        const isTemplate = !!data.resetQuantities;
        const chapters = await prisma.muebleChapter.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
              include: {
                details: { orderBy: { sortOrder: "asc" } },
                quotes: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        });
        for (const ch of chapters) {
          const newChapter = await prisma.muebleChapter.create({
            data: {
              budgetVersionId: budget.id,
              chapterNumber: ch.chapterNumber,
              name: ch.name,
              sortOrder: ch.sortOrder,
            },
          });
          for (const item of ch.items) {
            const newItem = await prisma.muebleItem.create({
              data: {
                budgetVersionId: budget.id,
                chapterId: newChapter.id,
                itemNumber: item.itemNumber,
                name: item.name,
                descriptionGeneral: item.descriptionGeneral,
                quantity: isTemplate ? 1 : item.quantity,
                supplier: item.supplier, // preservar — proveedores son típicos
                costDistributor: isTemplate ? 0 : item.costDistributor,
                utilityPercentage: item.utilityPercentage, // % se mantiene
                clientPriceNet: isTemplate ? 0 : item.clientPriceNet,
                clientPriceIva: isTemplate ? 0 : item.clientPriceIva,
                sortOrder: item.sortOrder,
              },
            });
            for (const det of item.details) {
              await prisma.muebleDetail.create({
                data: {
                  itemId: newItem.id,
                  name: det.name,
                  material: det.material,
                  sortOrder: det.sortOrder,
                },
              });
            }
            // En modo plantilla NO copiamos cotizaciones alternativas.
            if (!isTemplate) {
              for (const q of item.quotes) {
                await prisma.muebleQuote.create({
                  data: {
                    itemId: newItem.id,
                    supplier: q.supplier,
                    costDistributor: q.costDistributor,
                    utilityPercentage: q.utilityPercentage,
                    clientPriceNet: q.clientPriceNet,
                    clientPriceIva: q.clientPriceIva,
                    notes: q.notes,
                    isSelected: q.isSelected,
                    sortOrder: q.sortOrder,
                  },
                });
              }
            }
          }
        }
      }

      if (data.type === "artefactos") {
        const items = await prisma.artefactoItem.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
        });
        for (const item of items) {
          await prisma.artefactoItem.create({
            data: {
              budgetVersionId: budget.id,
              room: item.room,
              subcategory: item.subcategory,
              name: item.name,
              detail: item.detail,
              brand: item.brand,
              quantity: item.quantity,
              listPrice: item.listPrice,
              discountPercent: item.discountPercent,
              clientPrice: item.clientPrice,
              realCostBlarq: item.realCostBlarq,
              referenceLink: item.referenceLink,
              // La foto (imageUrl), el vínculo al catálogo (catalogId) y la
              // marca de "despegada del catálogo" (priceOverridden) también se
              // copian. Sin imageUrl la cotización duplicada quedaba sin fotos
              // (bug reportado). Sin catalogId/priceOverridden se perdía el
              // vínculo al catálogo y el estado de precio editado a mano.
              imageUrl: item.imageUrl,
              catalogId: item.catalogId,
              priceOverridden: item.priceOverridden,
              sortOrder: item.sortOrder,
            },
          });
        }
      }

      // Copiar formas de pago — salvo en modo plantilla, donde las formas
      // de pago son específicas del proyecto fuente y no deben heredarse.
      if (isTemplateMode) {
        // skip
      } else {
      const payments = await prisma.paymentTerm.findMany({
        where: { budgetVersionId: previousVersion.id },
        orderBy: { sortOrder: "asc" },
      });
      for (const pt of payments) {
        await prisma.paymentTerm.create({
          data: {
            budgetVersionId: budget.id,
            stage: pt.stage,
            percentage: pt.percentage,
            amount: pt.amount,
            sortOrder: pt.sortOrder,
          },
        });
      }
      } // cierra else !isTemplateMode
    }

    return NextResponse.json(budget);
  } catch (error) {
    console.error("Error creating budget:", error);
    return NextResponse.json(
      { error: "Error al crear presupuesto" },
      { status: 500 }
    );
  }
}
