import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Crear nueva versión de presupuesto
export async function POST(request: NextRequest) {
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
    const isTemplateMode = !!data.resetQuantities;
    const baseId = data.baseVersionId || (existing.length > 0 ? existing[0].id : null);
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
        });

        // Si se está usando como plantilla (importar desde otro proyecto),
        // queremos cantidades en 0 y precios refrescados del catálogo actual.
        // Usado por el flujo "Importar desde otro proyecto" — el "Duplicar"
        // normal sigue copiando todo tal cual.
        const isTemplateMode = !!data.resetQuantities;
        const refreshPrices = !!data.refreshFromCatalog;

        // Pre-cargar el catálogo si hay que refrescar precios
        const partidaIds = refreshPrices
          ? items.filter((i) => i.catalogPartidaId).map((i) => i.catalogPartidaId!)
          : [];
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

          const quantity = isTemplateMode ? 0 : item.quantity;
          const total = quantity * unitPrice;

          await prisma.obraItem.create({
            data: {
              budgetVersionId: budget.id,
              // En modo plantilla NO preservamos lineageId — el ítem importado
              // es un punto de partida nuevo, no una continuación de la línea
              // de versiones del proyecto fuente.
              lineageId: isTemplateMode ? undefined : item.lineageId,
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              descriptionCliente: item.descriptionCliente,
              descriptionMaestro: item.descriptionMaestro,
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
        }
      }

      if (data.type === "muebles") {
        // En modo plantilla (importar desde otro proyecto):
        // - Mantenemos chapters + estructura de items (Mueble, Herrajes,
        //   Cubierta, etc) + supplier (Carlos, Giacomo, etc — son fijos).
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
                descriptionGeneral: isTemplate ? null : item.descriptionGeneral,
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
