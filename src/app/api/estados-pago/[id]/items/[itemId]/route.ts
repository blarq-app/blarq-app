import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { validateQuantityExecuted } from "@/lib/ep/calculations";

// Guardado de UNA partida del EP.
//
// El editor del EP guarda solo (al salir de cada campo), igual que el editor de
// obra y el de muebles. Antes había un único PUT que mandaba el EP ENTERO: con
// 50 partidas eso significaba reescribir las 50 en cada edición, y dos guardados
// encimados se pisaban entre sí (el que salía primero volvía con datos viejos y
// revertía la fila que se acababa de tocar — el mismo problema que las cantidades
// de herrajes en el PR #202).
//
// Acá cada guardado toca SOLO la fila editada, así que dos filas editadas rápido
// una detrás de otra son incapaces de pisarse.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id, itemId } = await params;
    const data = await request.json();

    // La partida tiene que pertenecer a ESTE EP: el id del EP viene de la URL y
    // no se puede confiar en que el del item corresponda.
    const item = await prisma.estadoPagoItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        estadoPagoId: true,
        quantity: true,
        lineageId: true,
        outOfScope: true,
        estadoPago: {
          select: { id: true, status: true, projectId: true, maestroId: true, number: true },
        },
      },
    });
    if (!item || item.estadoPagoId !== id) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }

    // Un EP cerrado tiene las cantidades congeladas: son la base del EP
    // siguiente y ya se le pagaron al maestro.
    if (item.estadoPago.status === "cerrado") {
      return NextResponse.json(
        { error: "El EP está cerrado y no puede editarse." },
        { status: 409 }
      );
    }

    const patch: {
      quantityExecuted?: number;
      pctAccumulated?: number;
      descriptionMaestro?: string | null;
    } = {};

    if (data.quantityExecuted !== undefined) {
      const nueva = Number(data.quantityExecuted);

      // Mismo tope que ve el editor en pantalla, revalidado acá: la cantidad no
      // puede bajar de la ya pagada en EPs cerrados anteriores ni pasarse de la
      // presupuestada. El "anterior" se mide sobre la MISMA serie de maestro,
      // igual que la pantalla del EP.
      const prevEps = await prisma.estadoPago.findMany({
        where: {
          projectId: item.estadoPago.projectId,
          maestroId: item.estadoPago.maestroId,
          number: { lt: item.estadoPago.number },
          status: "cerrado",
        },
        select: { items: { select: { lineageId: true, quantityExecuted: true } } },
      });
      let prevExecutedQuantity = 0;
      for (const p of prevEps) {
        for (const i of p.items) {
          if (i.lineageId === item.lineageId) {
            prevExecutedQuantity = Math.max(prevExecutedQuantity, i.quantityExecuted);
          }
        }
      }

      const err = validateQuantityExecuted(nueva, {
        prevExecutedQuantity,
        quantity: item.quantity,
        outOfScope: item.outOfScope,
      });
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      patch.quantityExecuted = nueva;
      // El % se deriva de la cantidad (la cantidad es el dato base, ver
      // src/lib/ep/calculations.ts). Se guarda igual porque hay lecturas que lo
      // leen directo de la fila.
      patch.pctAccumulated =
        item.quantity > 0 ? (nueva / item.quantity) * 100 : 0;
    }

    if (data.descriptionMaestro !== undefined) {
      patch.descriptionMaestro = data.descriptionMaestro;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    const updated = await prisma.estadoPagoItem.update({
      where: { id: itemId },
      data: patch,
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating EP item:", error);
    return NextResponse.json({ error: "Error al guardar la partida" }, { status: 500 });
  }
}
