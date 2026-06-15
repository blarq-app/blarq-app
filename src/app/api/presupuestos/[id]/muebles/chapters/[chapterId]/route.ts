import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { chapterId } = await params;
    const data = await request.json();
    const updated = await prisma.muebleChapter.update({
      where: { id: chapterId },
      data: {
        name: data.name,
        chapterNumber: data.chapterNumber,
        sortOrder: data.sortOrder,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating muebles chapter:", error);
    return NextResponse.json(
      { error: "Error al actualizar capítulo" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { chapterId } = await params;
    await prisma.muebleChapter.delete({ where: { id: chapterId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting muebles chapter:", error);
    return NextResponse.json(
      { error: "Error al eliminar capítulo" },
      { status: 500 }
    );
  }
}
