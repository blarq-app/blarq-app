import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { recomputeAndPersistHerrajeItem } from "@/lib/presupuesto/muebleHerrajes";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const data = await request.json();

    const existing = await prisma.muebleItem.findUnique({
      where: { id: itemId },
      select: { kind: true },
    });

    // Partida de herrajes: el costo lo manejan las líneas. Acá solo se editan
    // campos sueltos (nombre, descripción y sobre todo el MARGEN) y se recalcula
    // el total DESDE LAS LÍNEAS — nunca desde el costDistributor del body (que
    // vendría 0 y borraría el costo). El proveedor es por línea: no se toca.
    if (existing?.kind === "herrajes") {
      await prisma.muebleItem.update({
        where: { id: itemId },
        data: {
          name: data.name,
          descriptionGeneral: data.descriptionGeneral ?? null,
          ...(data.utilityPercentage !== undefined && {
            utilityPercentage: data.utilityPercentage,
          }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        },
      });
      const recomputed = await recomputeAndPersistHerrajeItem(itemId);
      return NextResponse.json(recomputed);
    }

    const cost = data.costDistributor ?? 0;
    const utility = data.utilityPercentage ?? 0;
    const net = cost * (1 + utility);
    const iva = net * 1.19;

    const updated = await prisma.muebleItem.update({
      where: { id: itemId },
      data: {
        itemNumber: data.itemNumber,
        name: data.name,
        descriptionGeneral: data.descriptionGeneral ?? null,
        quantity: data.quantity ?? 1,
        supplier: data.supplier ?? null,
        costDistributor: cost,
        utilityPercentage: utility,
        clientPriceNet: net,
        clientPriceIva: iva,
        sortOrder: data.sortOrder,
      },
    });

    // Mantener la quote activa sincronizada con los valores del item
    // (si el usuario edita supplier/cost/utility desde el panel principal,
    // se refleja también en la cotización activa).
    await prisma.muebleQuote.updateMany({
      where: { itemId, isSelected: true },
      data: {
        supplier: updated.supplier,
        costDistributor: updated.costDistributor,
        utilityPercentage: updated.utilityPercentage,
        clientPriceNet: updated.clientPriceNet,
        clientPriceIva: updated.clientPriceIva,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating mueble item:", error);
    return NextResponse.json(
      { error: "Error al actualizar item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    await prisma.muebleItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mueble item:", error);
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    );
  }
}
