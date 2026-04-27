import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Agregar partida de obra
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    // Calcular número de item automáticamente
    const existingItems = await prisma.obraItem.findMany({
      where: { budgetVersionId, chapter: data.chapter },
      orderBy: { sortOrder: "desc" },
    });

    const chapterIndex = getChapterIndex(data.chapter);
    const itemIndex = existingItems.length + 1;
    const itemNumber = `${chapterIndex}.${itemIndex}`;

    // Calcular el siguiente sortOrder global
    const allItems = await prisma.obraItem.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSortOrder = allItems.length > 0 ? allItems[0].sortOrder + 1 : 0;

    const total = (data.quantity || 0) * (data.unitPrice || 0);

    const item = await prisma.obraItem.create({
      data: {
        budgetVersionId,
        chapter: data.chapter,
        itemNumber,
        name: data.name,
        descriptionCliente: data.descriptionCliente ?? data.description ?? null,
        descriptionMaestro: data.descriptionMaestro ?? null,
        unit: data.unit || "GL",
        quantity: data.quantity || 0,
        unitPrice: data.unitPrice || 0,
        total,
        costMaterial: data.costMaterial || null,
        costLabor: data.costLabor || null,
        costSubcontract: data.costSubcontract || null,
        costMargin: data.costMargin || null,
        costTools: data.costTools || null,
        costLoss: data.costLoss || null,
        catalogPartidaId: data.catalogPartidaId || null,
        sortOrder: nextSortOrder,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating obra item:", error);
    return NextResponse.json(
      { error: "Error al crear partida" },
      { status: 500 }
    );
  }
}

// Actualizar múltiples partidas (bulk update)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // consume params
    const { items } = await request.json();

    const updated = [];
    for (const item of items) {
      const total = (item.quantity || 0) * (item.unitPrice || 0);
      const result = await prisma.obraItem.update({
        where: { id: item.id },
        data: {
          name: item.name,
          descriptionCliente: item.descriptionCliente ?? item.description,
          descriptionMaestro: item.descriptionMaestro,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total,
          costMaterial: item.costMaterial,
          costLabor: item.costLabor,
          costSubcontract: item.costSubcontract,
          costMargin: item.costMargin,
          costTools: item.costTools,
          costLoss: item.costLoss,
          sortOrder: item.sortOrder,
        },
      });
      updated.push(result);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating obra items:", error);
    return NextResponse.json(
      { error: "Error al actualizar partidas" },
      { status: 500 }
    );
  }
}

function getChapterIndex(chapter: string): number {
  const chapters: Record<string, number> = {
    demoliciones: 1,
    reparaciones: 2,
    electricas: 3,
    sanitarias: 4,
    terminaciones: 5,
    limpieza: 6,
  };
  return chapters[chapter] || 99;
}
