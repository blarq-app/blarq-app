/**
 * Reordenar tipos dentro de una pestaña (arrastrar).
 * Body: { items: [{ id: string, sortOrder: number }] }
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
        prisma.artefactoTipo.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        })
      )
    );

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (error) {
    console.error("Error reordenando tipos:", error);
    return NextResponse.json(
      { error: "Error al reordenar tipos" },
      { status: 500 }
    );
  }
}
