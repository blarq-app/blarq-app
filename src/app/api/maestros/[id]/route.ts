import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();
    const maestro = await prisma.maestro.update({
      where: { id },
      data: {
        name: data.name,
        rut: data.rut || null,
        phone: data.phone || null,
        emitsInvoice: !!data.emitsInvoice,
        notes: data.notes || null,
      },
    });
    return NextResponse.json(maestro);
  } catch (error) {
    console.error("Error updating maestro:", error);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    await prisma.maestro.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting maestro:", error);
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}
