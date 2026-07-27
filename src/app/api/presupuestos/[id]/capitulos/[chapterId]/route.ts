/**
 * Renombrar (PUT) o borrar (DELETE) un capítulo de obra.
 *
 * Borrar SOLO se permite si el capítulo está vacío. Un capítulo de obra con
 * partidas adentro es plata presupuestada: si el borrado arrastrara las
 * partidas (como hace muebles), un click de más se lleva puesto medio
 * presupuesto. Con partidas adentro la app pide moverlas primero — arrastrarlas
 * a otro capítulo ya funciona.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId, chapterId } = await params;
    const data = await request.json();
    const name = String(data?.name ?? "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "El capítulo necesita un nombre" },
        { status: 400 }
      );
    }

    // Scopeado a la versión: un id de capítulo de otro presupuesto no se toca.
    const { count } = await prisma.obraChapter.updateMany({
      where: { id: chapterId, budgetVersionId },
      data: { name },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "Capítulo no encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json({ id: chapterId, name });
  } catch (error) {
    console.error("Error renombrando capítulo de obra:", error);
    return NextResponse.json(
      { error: "Error al renombrar el capítulo" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId, chapterId } = await params;

    const capitulo = await prisma.obraChapter.findFirst({
      where: { id: chapterId, budgetVersionId },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!capitulo) {
      return NextResponse.json(
        { error: "Capítulo no encontrado" },
        { status: 404 }
      );
    }
    if (capitulo._count.items > 0) {
      return NextResponse.json(
        {
          error: `Este capítulo tiene ${capitulo._count.items} partida${
            capitulo._count.items === 1 ? "" : "s"
          }. Movelas a otro capítulo antes de borrarlo.`,
        },
        { status: 409 }
      );
    }

    await prisma.obraChapter.delete({ where: { id: chapterId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error borrando capítulo de obra:", error);
    return NextResponse.json(
      { error: "Error al borrar el capítulo" },
      { status: 500 }
    );
  }
}
