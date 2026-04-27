import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; detailId: string }> }
) {
  try {
    const { detailId } = await params;
    const data = await request.json();
    const updated = await prisma.muebleDetail.update({
      where: { id: detailId },
      data: {
        name: data.name,
        material: data.material,
        sortOrder: data.sortOrder,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating mueble detail:", error);
    return NextResponse.json(
      { error: "Error al actualizar detalle" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; detailId: string }> }
) {
  try {
    const { detailId } = await params;
    await prisma.muebleDetail.delete({ where: { id: detailId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mueble detail:", error);
    return NextResponse.json(
      { error: "Error al eliminar detalle" },
      { status: 500 }
    );
  }
}
