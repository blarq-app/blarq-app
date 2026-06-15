import { prisma } from "@/lib/prisma";
import { parseRut } from "@/lib/clients/rut";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// PATCH para edición parcial de un proyecto. Útil para inline-edit en
// listados (ej: editar solo name o clientName). A diferencia de PUT,
// solo toca los campos que vengan en el body.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = (await request.json()) as Partial<{
      name: string;
      clientName: string;
      clientRut: string | null;
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
    if (data.clientRut !== undefined) {
      // null o "" → blanquea. String con valor → valida y normaliza.
      if (!data.clientRut) {
        update.clientRut = null;
      } else {
        const r = parseRut(data.clientRut);
        if (!r.ok) {
          return NextResponse.json(
            { error: `RUT del cliente inválido: ${r.reason}` },
            { status: 400 }
          );
        }
        update.clientRut = r.canonical;
      }
    }
    if (data.clientPhone !== undefined) update.clientPhone = data.clientPhone || null;
    if (data.clientEmail !== undefined) update.clientEmail = data.clientEmail || null;
    if (data.address !== undefined) update.address = data.address || null;
    if (typeof data.status === "string") update.status = data.status;
    if (data.notes !== undefined) update.notes = data.notes || null;
    if (data.numeroProyecto !== undefined) update.numeroProyecto = data.numeroProyecto;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para actualizar" }, { status: 400 });
    }

    // Validar unicidad de numeroProyecto antes de update — si no, Prisma
    // tira un P2002 con mensaje feo. Mejor un 409 explícito con mensaje
    // legible para que el inline-edit muestre algo útil.
    if (typeof data.numeroProyecto === "number") {
      const conflict = await prisma.project.findFirst({
        where: { numeroProyecto: data.numeroProyecto, NOT: { id } },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: `El número ${data.numeroProyecto} ya lo tiene "${conflict.name}". Elegí otro o liberá ése primero.`,
          },
          { status: 409 }
        );
      }
    }

    const project = await prisma.project.update({ where: { id }, data: update });
    return NextResponse.json(project);
  } catch (error) {
    console.error("Error patching project:", error);
    // Manejar específicamente el constraint de unicidad como fallback
    // (por si la validación previa no agarró el caso por race condition).
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ese número ya está en uso por otro proyecto." },
        { status: 409 }
      );
    }
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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    if (!data.name || !data.clientName) {
      return NextResponse.json(
        { error: "Nombre del proyecto y cliente son requeridos" },
        { status: 400 }
      );
    }

    // Misma validación de RUT que en POST: si vino, normalizar; si no, null.
    let clientRut: string | null = null;
    if (data.clientRut) {
      const r = parseRut(data.clientRut);
      if (!r.ok) {
        return NextResponse.json(
          { error: `RUT del cliente inválido: ${r.reason}` },
          { status: 400 }
        );
      }
      clientRut = r.canonical;
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        name: data.name,
        clientName: data.clientName,
        clientRut,
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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;

    // Defensa en profundidad: solo se pueden borrar cotizaciones sin convertir
    // (status "cotizacion" o "archivado"). Una cotización ya convertida en
    // proyecto (status "ejecucion"/"terminado") tiene obra viva, facturas y
    // estados de pago: borrarla es destructivo y se bloquea acá, no solo en la
    // UI. Si MJ realmente necesita borrar una obra viva, primero la archiva.
    const project = await prisma.project.findUnique({
      where: { id },
      select: { status: true, numeroProyecto: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: "La cotización no existe" },
        { status: 404 }
      );
    }
    if (project.status !== "cotizacion" && project.status !== "archivado") {
      return NextResponse.json(
        {
          error:
            "Solo se pueden eliminar cotizaciones sin convertir. Esta ya es un proyecto en ejecución.",
        },
        { status: 400 }
      );
    }

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
