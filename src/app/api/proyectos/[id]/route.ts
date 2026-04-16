import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    if (!data.name || !data.clientName) {
      return NextResponse.json(
        { error: "Nombre del proyecto y cliente son requeridos" },
        { status: 400 }
      );
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        name: data.name,
        clientName: data.clientName,
        clientPhone: data.clientPhone || null,
        clientEmail: data.clientEmail || null,
        address: data.address || null,
        status: data.status || "cotizacion",
        startDate: data.startDate ? new Date(data.startDate) : null,
        estimatedEndDate: data.estimatedEndDate
          ? new Date(data.estimatedEndDate)
          : null,
        ufReference: data.ufReference || null,
        notes: data.notes || null,
        maestroId: data.maestroId || null,
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    console.error("Error updating project:", error);
    return NextResponse.json(
      { error: "Error al actualizar el proyecto" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Error al eliminar el proyecto" },
      { status: 500 }
    );
  }
}
