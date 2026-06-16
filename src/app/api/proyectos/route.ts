import { prisma } from "@/lib/prisma";
import { parseRut } from "@/lib/clients/rut";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// GET /api/proyectos
// Listado liviano de proyectos para selectors (modal asignar pagos, etc).
// Devuelve id + name + numeroProyecto + isInternal, ordenado por número.
export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      numeroProyecto: true,
      isInternal: true,
    },
    orderBy: [{ isInternal: "asc" }, { numeroProyecto: "asc" }],
  });
  return NextResponse.json({ ok: true, projects });
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();

    if (!data.name || !data.clientName) {
      return NextResponse.json(
        { error: "Nombre del proyecto y cliente son requeridos" },
        { status: 400 }
      );
    }

    // Si vino RUT, validar DV y normalizar a forma canónica antes de
    // guardar. Si vino vacío, queda null. Validación duplicada acá
    // (también está en el form) para que la API sea segura aunque la
    // llamen desde otro cliente o por curl.
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

    const project = await prisma.project.create({
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
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Error al crear el proyecto" },
      { status: 500 }
    );
  }
}
