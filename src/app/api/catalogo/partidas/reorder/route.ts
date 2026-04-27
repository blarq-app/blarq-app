import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Reordenar partidas dentro de una categoría.
// Body: { items: [{ id: string, sortOrder: number }] }
export async function PATCH(request: NextRequest) {
  try {
    const { items } = (await request.json()) as {
      items: { id: string; sortOrder: number }[];
    };
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "items debe ser un array" },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      items.map((it) =>
        prisma.partidaCatalog.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        })
      )
    );

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (error) {
    console.error("Error reordering partidas:", error);
    return NextResponse.json(
      { error: "Error al reordenar" },
      { status: 500 }
    );
  }
}
