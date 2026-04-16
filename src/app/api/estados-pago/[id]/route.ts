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

    if (Array.isArray(data.items)) {
      await Promise.all(
        data.items.map((it: { id: string; pctAccumulated: number }) =>
          prisma.estadoPagoItem.update({
            where: { id: it.id },
            data: { pctAccumulated: it.pctAccumulated },
          })
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
    await prisma.estadoPago.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting EP:", error);
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}
