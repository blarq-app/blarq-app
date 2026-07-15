import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators, findLatestObraBudget } from "@/lib/ep/snapshot";
import { requireSession } from "@/lib/apiAuth";

// Listar EPs del proyecto
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id: projectId } = await params;
  const eps = await prisma.estadoPago.findMany({
    where: { projectId },
    orderBy: { number: "desc" },
    include: { items: true },
  });
  return NextResponse.json(eps);
}

// Crear nuevo EP
// Snapshot de la obra del presupuesto vigente, copia %avance del EP anterior.
// Body opcional: { maestroId } → EP de ese maestro (solo sus partidas,
// numeración propia). Sin maestroId → EP legacy de obra completa.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: projectId } = await params;

    // maestroId puede venir en el body (EP por maestro) o no (legacy).
    // budgetVersionId puede venir si MJ eligió a mano sobre qué versión del
    // presupuesto armar el EP (si no, se usa la versión de obra vigente).
    let maestroId: string | null = null;
    let budgetVersionId: string | null = null;
    try {
      const body = await request.json();
      if (body && typeof body.maestroId === "string") maestroId = body.maestroId;
      if (body && typeof body.budgetVersionId === "string")
        budgetVersionId = body.budgetVersionId;
    } catch {
      // sin body → EP legacy de obra completa, versión vigente
    }

    // Versión elegida a mano (validada: obra de este proyecto) o, por defecto,
    // la vigente.
    const obraBudget = budgetVersionId
      ? await prisma.budgetVersion.findFirst({
          where: { id: budgetVersionId, projectId, type: "obra" },
          include: { obraItems: { orderBy: { sortOrder: "asc" } } },
        })
      : await findLatestObraBudget(prisma, projectId);
    if (budgetVersionId && !obraBudget) {
      return NextResponse.json(
        { error: "La versión de presupuesto elegida no existe o no es de esta obra" },
        { status: 400 }
      );
    }
    if (!obraBudget || obraBudget.obraItems.length === 0) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra con partidas para este proyecto" },
        { status: 400 }
      );
    }

    // Si es un EP de maestro, el snapshot toma SOLO sus partidas.
    const itemsForEp = maestroId
      ? obraBudget.obraItems.filter((it) => it.maestroId === maestroId)
      : obraBudget.obraItems;

    if (maestroId && itemsForEp.length === 0) {
      return NextResponse.json(
        {
          error:
            "Este maestro todavía no tiene partidas asignadas. Asignale partidas antes de crear su estado de pago.",
        },
        { status: 400 }
      );
    }

    // Siguiente número correlativo — por (proyecto, maestro) cuando hay maestro.
    const last = await prisma.estadoPago.findFirst({
      where: { projectId, maestroId },
      orderBy: { number: "desc" },
    });
    const nextNumber = (last?.number || 0) + 1;

    const { prevExecutedByLineage } = await buildPrevAccumulators(prisma, {
      projectId,
      maestroId,
    });

    const ep = await prisma.estadoPago.create({
      data: {
        projectId,
        maestroId,
        budgetVersionId: obraBudget.id,
        number: nextNumber,
        items: {
          create: itemsForEp.map((item, idx) => {
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
