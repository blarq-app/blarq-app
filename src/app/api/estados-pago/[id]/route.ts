import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ep = await prisma.estadoPago.findUnique({
    where: { id },
    include: {
      project: { include: { maestro: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!ep) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(ep);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    // Actualizar EP (status, notes, date) y/o items (% avance)
    const ep = await prisma.estadoPago.update({
      where: { id },
      data: {
        status: data.status,
        notes: data.notes,
        date: data.date ? new Date(data.date) : undefined,
      },
    });

    // Bloquear edición si el EP está cerrado
    const current = await prisma.estadoPago.findUnique({
      where: { id },
      select: { status: true },
    });
    if (current?.status === "cerrado" && (data.items || data.notes !== undefined || data.date !== undefined)) {
      return NextResponse.json(
        { error: "El EP está cerrado y no puede editarse." },
        { status: 409 }
      );
    }

    if (Array.isArray(data.items)) {
      await Promise.all(
        data.items.map(
          (it: {
            id: string;
            quantityExecuted?: number;
            pctAccumulated?: number;
            descriptionMaestro?: string | null;
          }) => {
            const patch: {
              quantityExecuted?: number;
              pctAccumulated?: number;
              descriptionMaestro?: string | null;
            } = {};
            if (it.quantityExecuted !== undefined) patch.quantityExecuted = it.quantityExecuted;
            if (it.pctAccumulated !== undefined) patch.pctAccumulated = it.pctAccumulated;
            if (it.descriptionMaestro !== undefined) patch.descriptionMaestro = it.descriptionMaestro;
            return prisma.estadoPagoItem.update({
              where: { id: it.id },
              data: patch,
            });
          }
        )
      );
    }

    return NextResponse.json(ep);
  } catch (error) {
    console.error("Error updating EP:", error);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Bloquear eliminación de EP pagados para evitar doble-pago
    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      select: { status: true, number: true },
    });
    if (!ep) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    if (ep.status === "pagado") {
      return NextResponse.json(
        { error: `No se puede eliminar el EP #${ep.number} porque ya está pagado. Cambia su estado primero.` },
        { status: 400 }
      );
    }

    await prisma.estadoPago.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting EP:", error);
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}
