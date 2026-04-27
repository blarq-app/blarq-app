import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Duplica una partida del catálogo + sus componentes.
// La copia queda al final de la categoría con nombre "<original> (copia)".
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const original = await prisma.partidaCatalog.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!original) {
      return NextResponse.json(
        { error: "Partida no encontrada" },
        { status: 404 }
      );
    }

    // Próximo sortOrder en la categoría
    const last = await prisma.partidaCatalog.findFirst({
      where: { category: original.category },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? -1) + 1;

    // Nombre con sufijo único (evita colisión con UNIQUE [category, name])
    let newName = `${original.name} (COPIA)`;
    let suffix = 2;
    while (
      await prisma.partidaCatalog.findFirst({
        where: { category: original.category, name: newName },
        select: { id: true },
      })
    ) {
      newName = `${original.name} (COPIA ${suffix})`;
      suffix++;
    }

    const copy = await prisma.partidaCatalog.create({
      data: {
        category: original.category,
        name: newName,
        descriptionCliente: original.descriptionCliente,
        descriptionMaestro: original.descriptionMaestro,
        sortOrder: nextSortOrder,
        unit: original.unit,
        unitPrice: original.unitPrice,
        costMaterial: original.costMaterial,
        costLabor: original.costLabor,
        costTools: original.costTools,
        costMargin: original.costMargin,
        costLoss: original.costLoss,
        costSubcontract: original.costSubcontract,
        components: {
          create: original.components.map((c) => ({
            type: c.type,
            description: c.description,
            unit: c.unit,
            quantity: c.quantity,
            unitCost: c.unitCost,
            totalCost: c.totalCost,
            referenceLink: c.referenceLink,
            materialId: c.materialId,
            sortOrder: c.sortOrder,
          })),
        },
      },
      include: { components: true },
    });

    return NextResponse.json(copy);
  } catch (error) {
    console.error("Error duplicating partida:", error);
    return NextResponse.json(
      { error: "Error al duplicar partida" },
      { status: 500 }
    );
  }
}
