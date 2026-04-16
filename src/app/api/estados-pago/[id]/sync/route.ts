import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Sincroniza los items del EP con el presupuesto de obra más reciente.
// Mantiene el % avance existente por obraItemId.
// Agrega partidas nuevas, actualiza datos (nombre, cant, P.U MO), y elimina
// las que ya no están en el presupuesto.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!ep) {
      return NextResponse.json({ error: "EP no encontrado" }, { status: 404 });
    }

    const obraBudget =
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra", status: "aprobado" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      })) ||
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      }));

    if (!obraBudget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra para sincronizar" },
        { status: 400 }
      );
    }

    // Map existing EP items por obraItemId
    const existingByObraId = new Map(
      ep.items.map((i) => [i.obraItemId, i])
    );
    const budgetIds = new Set(obraBudget.obraItems.map((b) => b.id));

    // 1) Eliminar items cuyo obraItem ya no existe en el presupuesto
    const toDelete = ep.items.filter((i) => !budgetIds.has(i.obraItemId));
    if (toDelete.length) {
      await prisma.estadoPagoItem.deleteMany({
        where: { id: { in: toDelete.map((i) => i.id) } },
      });
    }

    // 2) Upsert por cada partida actual del presupuesto
    for (let idx = 0; idx < obraBudget.obraItems.length; idx++) {
      const b = obraBudget.obraItems[idx];
      const laborUnitPrice = b.costLabor ?? 0;
      const existing = existingByObraId.get(b.id);
      const data = {
        chapter: b.chapter,
        itemNumber: b.itemNumber,
        name: b.name,
        unit: b.unit,
        quantity: b.quantity,
        laborUnitPrice,
        laborTotal: laborUnitPrice * b.quantity,
        sortOrder: b.sortOrder ?? idx,
      };

      if (existing) {
        await prisma.estadoPagoItem.update({
          where: { id: existing.id },
          data, // preserva pctAccumulated
        });
      } else {
        await prisma.estadoPagoItem.create({
          data: {
            ...data,
            estadoPagoId: ep.id,
            obraItemId: b.id,
            pctAccumulated: 0,
          },
        });
      }
    }

    const updated = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({
      ep: updated,
      added: obraBudget.obraItems.filter((b) => !existingByObraId.has(b.id))
        .length,
      removed: toDelete.length,
      updated: obraBudget.obraItems.filter((b) => existingByObraId.has(b.id))
        .length,
    });
  } catch (error) {
    console.error("Error sync EP:", error);
    return NextResponse.json(
      { error: "Error al sincronizar EP" },
      { status: 500 }
    );
  }
}
