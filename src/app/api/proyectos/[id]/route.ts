import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// PATCH para edición parcial de un proyecto. Útil para inline-edit en
// listados (ej: editar solo name o clientName). A diferencia de PUT,
// solo toca los campos que vengan en el body.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = (await request.json()) as Partial<{
      name: string;
      clientName: string;
      clientPhone: string;
      clientEmail: string;
      address: string;
      status: string;
      notes: string;
      numeroProyecto: number | null;
    }>;

    // Whitelist de campos editables y filtro de undefined
    const update: Record<string, unknown> = {};
    if (typeof data.name === "string" && data.name.trim()) update.name = data.name.trim();
    if (typeof data.clientName === "string" && data.clientName.trim())
      update.clientName = data.clientName.trim();
    if (data.clientPhone !== undefined) update.clientPhone = data.clientPhone || null;
    if (data.clientEmail !== undefined) update.clientEmail = data.clientEmail || null;
    if (data.address !== undefined) update.address = data.address || null;
    if (typeof data.status === "string") update.status = data.status;
    if (data.notes !== undefined) update.notes = data.notes || null;
    if (data.numeroProyecto !== undefined) update.numeroProyecto = data.numeroProyecto;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para actualizar" }, { status: 400 });
    }

    const project = await prisma.project.update({ where: { id }, data: update });
    return NextResponse.json(project);
  } catch (error) {
    console.error("Error patching project:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al actualizar" },
      { status: 500 }
    );
  }
}

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
