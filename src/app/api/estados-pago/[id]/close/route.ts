import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators } from "@/lib/ep/snapshot";
import { requireSession } from "@/lib/apiAuth";

// Cierra un EP en borrador. Genera snapshot inmutable de amountPaid por partida.
//   amountPaid = (quantityExecuted - prevExecutedQuantity) × laborUnitPrice
// Una vez cerrado, las partidas quedan inmutables aunque cambien quantity o pu en V2.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!ep) {
      return NextResponse.json({ error: "EP no encontrado" }, { status: 404 });
    }
    if (ep.status === "cerrado") {
      return NextResponse.json(
        { error: "Este EP ya está cerrado." },
        { status: 409 }
      );
    }

    const { prevExecutedByLineage } = await buildPrevAccumulators(prisma, {
      projectId: ep.projectId,
      beforeNumber: ep.number,
    });

    // Cerrar en transacción
    await prisma.$transaction([
      ...ep.items.map((it) => {
        const prevQty = prevExecutedByLineage.get(it.lineageId) ?? 0;
        const newQty = Math.max(0, it.quantityExecuted - prevQty);
        const amountPaid = newQty * it.laborUnitPrice;
        return prisma.estadoPagoItem.update({
          where: { id: it.id },
          data: { amountPaid },
        });
      }),
      prisma.estadoPago.update({
        where: { id },
        data: { status: "cerrado", closedAt: new Date() },
      }),
    ]);

    const updated = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error closing EP:", error);
    return NextResponse.json(
      { error: "Error al cerrar EP" },
      { status: 500 }
    );
  }
}
