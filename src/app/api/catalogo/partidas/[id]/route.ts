import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    // Partial update: only set fields that were explicitly passed.
    // Lets callers update description without touching costs and vice versa.
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.category !== undefined) payload.category = data.category;
    // Compat: aceptar tanto descriptionCliente como description (legacy)
    if (data.descriptionCliente !== undefined) payload.descriptionCliente = data.descriptionCliente;
    else if (data.description !== undefined) payload.descriptionCliente = data.description;
    if (data.descriptionMaestro !== undefined) payload.descriptionMaestro = data.descriptionMaestro;
    if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
    if (data.unit !== undefined) payload.unit = data.unit;
    if (data.unitPrice !== undefined) payload.unitPrice = data.unitPrice ?? 0;
    if (data.costMaterial !== undefined) payload.costMaterial = data.costMaterial ?? 0;
    if (data.costLabor !== undefined) payload.costLabor = data.costLabor ?? 0;
    if (data.costTools !== undefined) payload.costTools = data.costTools ?? 0;
    if (data.costMargin !== undefined) payload.costMargin = data.costMargin ?? 0;
    if (data.costLoss !== undefined) payload.costLoss = data.costLoss ?? 0;
    if (data.costSubcontract !== undefined) payload.costSubcontract = data.costSubcontract ?? 0;

    const partida = await prisma.partidaCatalog.update({
      where: { id },
      data: payload,
    });

    return NextResponse.json(partida);
  } catch (error) {
    console.error("Error updating partida:", error);
    return NextResponse.json({ error: "Error al actualizar partida" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Bloquear si está en uso en algún ObraItem (cualquier presupuesto)
    const usageCount = await prisma.obraItem.count({
      where: { catalogPartidaId: id },
    });
    if (usageCount > 0) {
      const partida = await prisma.partidaCatalog.findUnique({
        where: { id },
        select: { name: true },
      });
      return NextResponse.json(
        {
          error:
            `Esta partida ${partida ? `("${partida.name}") ` : ""}está en uso en ${usageCount} presupuesto${usageCount === 1 ? "" : "s"}. ` +
            `Duplicala o creá una nueva si necesitás una variante.`,
        },
        { status: 409 }
      );
    }

    await prisma.partidaCatalog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting partida:", error);
    return NextResponse.json({ error: "Error al eliminar partida" }, { status: 500 });
  }
}
