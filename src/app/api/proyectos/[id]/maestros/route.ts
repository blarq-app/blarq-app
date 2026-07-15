import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Maestros que trabajan en una obra (ProjectMaestro). Una obra puede repartirse
// entre varios contratistas — este endpoint agrega uno a la obra. La asignación
// de partidas a cada maestro va aparte (ver [maestroId]/partidas).

// Agregar un maestro a la obra. Body:
//   { maestroId }                        → vincula un maestro que ya existe
//   { name, rut?, phone?, emitsInvoice? } → crea el maestro y lo vincula
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: projectId } = await params;
    const body = await request.json();

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    let maestroId: string | undefined = body.maestroId;

    // Si no viene un maestro existente, se crea uno nuevo con el nombre dado.
    if (!maestroId) {
      if (!body.name || !String(body.name).trim()) {
        return NextResponse.json(
          { error: "Falta el maestro (maestroId) o el nombre para crear uno" },
          { status: 400 }
        );
      }
      const nuevo = await prisma.maestro.create({
        data: {
          name: String(body.name).trim(),
          rut: body.rut || null,
          phone: body.phone || null,
          emitsInvoice: !!body.emitsInvoice,
        },
      });
      maestroId = nuevo.id;
    } else {
      const existe = await prisma.maestro.findUnique({ where: { id: maestroId } });
      if (!existe) {
        return NextResponse.json({ error: "Maestro no encontrado" }, { status: 404 });
      }
    }

    // Vincular a la obra. upsert para que agregar dos veces el mismo maestro no
    // reviente (idempotente).
    const link = await prisma.projectMaestro.upsert({
      where: { projectId_maestroId: { projectId, maestroId } },
      update: {},
      create: { projectId, maestroId },
      include: { maestro: true },
    });

    return NextResponse.json(link);
  } catch (error) {
    console.error("Error agregando maestro a la obra:", error);
    return NextResponse.json(
      { error: "Error al agregar el maestro a la obra" },
      { status: 500 }
    );
  }
}
