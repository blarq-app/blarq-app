import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Listar EPs del proyecto
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const eps = await prisma.estadoPago.findMany({
    where: { projectId },
    orderBy: { number: "desc" },
    include: { items: true },
  });
  return NextResponse.json(eps);
}

// Crear nuevo EP
// Snapshot de la obra del presupuesto vigente, copia %avance del EP anterior
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    // Buscar presupuesto de obra más reciente (aprobado si existe, si no el último)
    const obraBudget =
      (await prisma.budgetVersion.findFirst({
        where: { projectId, type: "obra", status: "aprobado" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      })) ||
      (await prisma.budgetVersion.findFirst({
        where: { projectId, type: "obra" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      }));

    if (!obraBudget || obraBudget.obraItems.length === 0) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra con partidas para este proyecto" },
        { status: 400 }
      );
    }

    // Siguiente número correlativo
    const last = await prisma.estadoPago.findFirst({
      where: { projectId },
      orderBy: { number: "desc" },
    });
    const nextNumber = (last?.number || 0) + 1;

    // Acumulado quantityExecuted previo por lineageId — solo de EPs CERRADOS anteriores.
    // Usamos lineageId (no obraItemId) para que el avance se herede aunque el
    // presupuesto haya cambiado de versión y los obraItemId hayan rotado.
    const prevClosedEps = await prisma.estadoPago.findMany({
      where: { projectId, status: "cerrado" },
      include: { items: true },
    });
    const prevExecutedMap = new Map<string, number>();
    for (const prev of prevClosedEps) {
      for (const it of prev.items) {
        const cur = prevExecutedMap.get(it.lineageId) ?? 0;
        prevExecutedMap.set(it.lineageId, Math.max(cur, it.quantityExecuted));
      }
    }

    const ep = await prisma.estadoPago.create({
      data: {
        projectId,
        budgetVersionId: obraBudget.id,
        number: nextNumber,
        items: {
          create: obraBudget.obraItems.map((item, idx) => {
            const laborUnitPrice = item.costLabor ?? 0;
            const prevQty = prevExecutedMap.get(item.lineageId) ?? 0;
            return {
              obraItemId: item.id,
              lineageId: item.lineageId,
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              descriptionMaestro: item.descriptionMaestro,
              unit: item.unit,
              quantity: item.quantity,
              laborUnitPrice,
              laborTotal: laborUnitPrice * item.quantity,
              // Arranca con el avance heredado del último EP cerrado
              quantityExecuted: prevQty,
              pctAccumulated:
                item.quantity > 0 ? (prevQty / item.quantity) * 100 : 0,
              sortOrder: item.sortOrder ?? idx,
            };
          }),
        },
      },
      include: { items: true },
    });

    return NextResponse.json(ep);
  } catch (error) {
    console.error("Error creating EP:", error);
    return NextResponse.json(
      { error: "Error al crear estado de pago" },
      { status: 500 }
    );
  }
}
