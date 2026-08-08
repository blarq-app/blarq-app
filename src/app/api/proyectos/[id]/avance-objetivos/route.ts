import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// PUT /api/proyectos/[id]/avance-objetivos
// Guarda el estado del Cuadro Resumen de la obra (Project.avanceObjetivos):
//   - { objetivos: {...} }              → borrador de la fila AVANCE (% por concepto)
//   - { mostrarVersionAnterior: bool }  → si se muestra la fila de comparación
// El merge es PARCIAL a propósito: el cuadro manda una cosa o la otra según lo
// que la usuaria tocó, y guardar el tilde de comparación no puede borrarle los
// % del avance que venía armando (ni al revés).
const CONCEPTOS = ["obra", "cocina", "sanitarios", "iluminacion", "muebles"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      objetivos?: Record<string, number>;
      mostrarVersionAnterior?: boolean;
    };

    const actual = await prisma.project.findUnique({
      where: { id },
      select: { avanceObjetivos: true },
    });
    const guardado =
      actual?.avanceObjetivos && typeof actual.avanceObjetivos === "object"
        ? (actual.avanceObjetivos as Record<string, unknown>)
        : {};
    const limpio: Record<string, number | boolean> = {};

    // Arrancamos de lo ya guardado, filtrado a las claves que conocemos: así el
    // merge nunca arrastra basura vieja ni pisa lo que no vino en el body.
    for (const k of CONCEPTOS) {
      const v = guardado[k];
      if (typeof v === "number") limpio[k] = v;
    }
    if (typeof guardado.mostrarVersionAnterior === "boolean") {
      limpio.mostrarVersionAnterior = guardado.mostrarVersionAnterior;
    }

    // Sanitizar lo que llega: solo números 0..100 por clave de concepto conocida.
    if (body.objetivos) {
      for (const k of CONCEPTOS) {
        if (k in body.objetivos) {
          limpio[k] = Math.max(0, Math.min(100, Math.round(Number(body.objetivos[k]) || 0)));
        }
      }
    }
    if (typeof body.mostrarVersionAnterior === "boolean") {
      limpio.mostrarVersionAnterior = body.mostrarVersionAnterior;
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
