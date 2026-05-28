import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators, findLatestObraBudget } from "@/lib/ep/snapshot";

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

    const obraBudget = await findLatestObraBudget(prisma, projectId);
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

    const { prevExecutedByLineage } = await buildPrevAccumulators(prisma, {
      projectId,
    });

    const ep = await prisma.estadoPago.create({
      data: {
        projectId,
        budgetVersionId: obraBudget.id,
        number: nextNumber,
        items: {
          create: obraBudget.obraItems.map((item, idx) => {
            const laborUnitPrice = item.costLabor ?? 0;
            const prevQty = prevExecutedByLineage.get(item.lineageId) ?? 0;
            return {
              obraItemId: item.id,
              lineageId: item.lineageId,
              chapter: item.chapter,
              subChapter: item.subChapter,
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
