import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

/**
 * DELETE /api/catalogo/plantillas-muebles/{id}?tipo=capitulo|partida
 *   Borra una plantilla (capítulo tipo con sus partidas, o partida tipo).
 *   No toca ninguna cotización: las partidas creadas desde la plantilla son
 *   copias independientes.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const tipo = request.nextUrl.searchParams.get("tipo");
    if (tipo === "capitulo") {
      await prisma.muebleChapterTemplate.delete({ where: { id } });
    } else if (tipo === "partida") {
      await prisma.muebleItemTemplate.delete({ where: { id } });
    } else {
      return NextResponse.json({ error: "tipo debe ser 'capitulo' o 'partida'" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error borrando plantilla de muebles:", error);
    return NextResponse.json({ error: "Error al borrar la plantilla" }, { status: 500 });
  }
}
