import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/proyectos
// Listado liviano de proyectos para selectors (modal asignar pagos, etc).
// Devuelve id + name + numeroProyecto + isInternal, ordenado por número.
export async function GET() {
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
  try {
    const data = await request.json();

    if (!data.name || !data.clientName) {
      return NextResponse.json(
        { error: "Nombre del proyecto y cliente son requeridos" },
        { status: 400 }
      );
    }

    const project = await prisma.project.create({
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
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Error al crear el proyecto" },
      { status: 500 }
    );
  }
}
