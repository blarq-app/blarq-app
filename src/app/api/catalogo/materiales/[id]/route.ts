import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    const material = await prisma.materialCatalog.update({
      where: { id },
      data: {
        name: data.name?.toUpperCase()?.trim(),
        unit: data.unit,
        netPrice: data.netPrice,
        referenceLink: data.referenceLink || null,
      },
    });

    return NextResponse.json(material);
  } catch (error) {
    console.error("Error updating material:", error);
    return NextResponse.json(
      { error: "Error al actualizar material" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.materialCatalog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting material:", error);
    return NextResponse.json(
      { error: "Error al eliminar material" },
      { status: 500 }
    );
  }
}
