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
    const baseId = data.baseVersionId || (existing.length > 0 ? existing[0].id : null);

    const budget = await prisma.budgetVersion.create({
      data: {
        projectId: data.projectId,
        version,
        type: data.type,
        status: "borrador",
        parentVersionId: baseId,
        observations: data.observations || null,
        ggPercentage: data.ggPercentage ?? 20,
        utilityPercentage: data.utilityPercentage ?? 5,
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
        for (const item of items) {
          await prisma.obraItem.create({
            data: {
              budgetVersionId: budget.id,
              lineageId: item.lineageId, // preservar identidad estable a través de versiones
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              descriptionCliente: item.descriptionCliente,
              descriptionMaestro: item.descriptionMaestro,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
              costMaterial: item.costMaterial,
              costLabor: item.costLabor,
              costSubcontract: item.costSubcontract,
              costMargin: item.costMargin,
              costTools: item.costTools,
              costLoss: item.costLoss,
              catalogPartidaId: item.catalogPartidaId,
              isCustomized: item.isCustomized, // preservar customizaciones al duplicar
              sortOrder: item.sortOrder,
            },
          });
        }
      }

      if (data.type === "muebles") {
        // Duplicar capítulos → items → detalles preservando estructura
        const chapters = await prisma.muebleChapter.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
              include: {
                details: { orderBy: { sortOrder: "asc" } },
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
                quantity: item.quantity,
                supplier: item.supplier,
                costDistributor: item.costDistributor,
                utilityPercentage: item.utilityPercentage,
                clientPriceNet: item.clientPriceNet,
                clientPriceIva: item.clientPriceIva,
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

      // Copiar formas de pago
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
