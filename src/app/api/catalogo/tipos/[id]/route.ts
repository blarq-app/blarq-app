/**
 * Renombrar o borrar un tipo del catálogo de artefactos.
 *
 * PATCH  /api/catalogo/tipos/{id} { name }  — renombra el tipo Y actualiza en
 *        bloque el `tag` de todos sus artefactos (el artefacto guarda el tipo
 *        por nombre, no por id).
 * DELETE /api/catalogo/tipos/{id}           — borra el tipo. BLOQUEADO si tiene
 *        artefactos: hay que moverlos primero (decisión de MJ).
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();
    const newName = String(data.name || "").trim();
    if (!newName) {
      return NextResponse.json(
        { error: "El nombre no puede quedar vacío" },
        { status: 400 }
      );
    }

    const tipo = await prisma.artefactoTipo.findUnique({ where: { id } });
    if (!tipo) {
      return NextResponse.json({ error: "Tipo no encontrado" }, { status: 404 });
    }
    if (newName === tipo.name) {
      return NextResponse.json(tipo); // sin cambios
    }

    // Renombrar el tipo + arrastrar el nuevo nombre a todos sus artefactos, en
    // una sola transacción. (El artefacto agrupa por `tag` = nombre del tipo.)
    try {
      const [updated] = await prisma.$transaction([
        prisma.artefactoTipo.update({
          where: { id },
          data: { name: newName },
        }),
        prisma.artefactoCatalog.updateMany({
          where: { subcategory: tipo.subcategory, tag: tipo.name },
          data: { tag: newName },
        }),
      ]);
      return NextResponse.json(updated);
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code?: string }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: `Ya existe un tipo "${newName}" en esta pestaña.` },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (error) {
    console.error("Error renombrando tipo:", error);
    return NextResponse.json(
      { error: "Error al renombrar tipo" },
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
    const tipo = await prisma.artefactoTipo.findUnique({ where: { id } });
    if (!tipo) {
      return NextResponse.json({ error: "Tipo no encontrado" }, { status: 404 });
    }

    // Bloquear si tiene artefactos (decisión de MJ): primero hay que vaciarlo.
    const enUso = await prisma.artefactoCatalog.count({
      where: { subcategory: tipo.subcategory, tag: tipo.name },
    });
    if (enUso > 0) {
      return NextResponse.json(
        {
          error: `No se puede borrar "${tipo.name}": tiene ${enUso} artefacto${
            enUso === 1 ? "" : "s"
          }. Movelos a otro tipo primero.`,
          count: enUso,
        },
        { status: 409 }
      );
    }

    await prisma.artefactoTipo.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error borrando tipo:", error);
    return NextResponse.json({ error: "Error al borrar tipo" }, { status: 500 });
  }
}
