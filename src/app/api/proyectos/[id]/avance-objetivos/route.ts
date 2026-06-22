import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// PUT /api/proyectos/[id]/avance-objetivos
// Guarda el borrador de la fila AVANCE del Cuadro Resumen (objetivos % por
// concepto), para que MJ no lo pierda al navegar. Body: { objetivos: {...} }.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as { objetivos?: Record<string, number> };
    const objetivos = body.objetivos ?? {};
    // Sanitizar: solo números 0..100 por clave de concepto conocida.
    const limpio: Record<string, number> = {};
    for (const [k, v] of Object.entries(objetivos)) {
      if (["obra", "cocina", "sanitarios", "iluminacion", "muebles"].includes(k)) {
        limpio[k] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
      }
    }
    await prisma.project.update({ where: { id }, data: { avanceObjetivos: limpio } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error guardando avance-objetivos:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
