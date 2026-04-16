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

    // EP anterior para copiar %
    const prevEp = last
      ? await prisma.estadoPago.findUnique({
          where: { id: last.id },
          include: { items: true },
        })
      : null;
    const prevPctMap = new Map<string, number>(
      (prevEp?.items || []).map((i) => [i.obraItemId, i.pctAccumulated])
    );

    const ep = await prisma.estadoPago.create({
      data: {
        projectId,
        number: nextNumber,
        items: {
          create: obraBudget.obraItems.map((item, idx) => {
            const laborUnitPrice = item.costLabor ?? 0;
            return {
              obraItemId: item.id,
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              unit: item.unit,
              quantity: item.quantity,
              laborUnitPrice,
              laborTotal: laborUnitPrice * item.quantity,
              pctAccumulated: prevPctMap.get(item.id) ?? 0,
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
