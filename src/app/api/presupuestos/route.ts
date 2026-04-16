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

    const versionNumber = existing.length + 1;
    const version = `V${versionNumber}`;

    const budget = await prisma.budgetVersion.create({
      data: {
        projectId: data.projectId,
        version,
        type: data.type,
        status: "borrador",
        observations: data.observations || null,
        ggPercentage: data.ggPercentage ?? 20,
        utilityPercentage: data.utilityPercentage ?? 5,
      },
    });

    // Si hay una versión anterior, copiar las partidas
    if (existing.length > 0) {
      const previousVersion = existing[0];

      if (data.type === "obra") {
        const items = await prisma.obraItem.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
        });
        for (const item of items) {
          await prisma.obraItem.create({
            data: {
              budgetVersionId: budget.id,
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
              costMaterial: item.costMaterial,
              costLabor: item.costLabor,
              costSubcontract: item.costSubcontract,
              costMargin: item.costMargin,
              sortOrder: item.sortOrder,
            },
          });
        }
      }

      if (data.type === "muebles") {
        const items = await prisma.muebleItem.findMany({
          where: { budgetVersionId: previousVersion.id },
          orderBy: { sortOrder: "asc" },
        });
        for (const item of items) {
          await prisma.muebleItem.create({
            data: {
              budgetVersionId: budget.id,
              subcategory: item.subcategory,
              description: item.description,
              supplier: item.supplier,
              costDistributor: item.costDistributor,
              utilityPercentage: item.utilityPercentage,
              clientPrice: item.clientPrice,
              clientPriceIva: item.clientPriceIva,
              sortOrder: item.sortOrder,
            },
          });
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
