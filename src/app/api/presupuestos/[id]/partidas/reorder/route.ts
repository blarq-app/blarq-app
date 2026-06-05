import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Reordenar partidas (ObraItem) de una versión de presupuesto a mano.
// MJ arrastra las filas para armar el orden cronológico de la obra. Además
// del orden (sortOrder), una partida puede MOVERSE a otro capítulo cuando se
// la arrastra a la zona de ese capítulo (ej. metió "piso flotante" en
// Eléctricas y la corre a Terminaciones) — por eso aceptamos también el
// chapter de cada fila y lo persistimos.
//
// Body: { items: [{ id: string, sortOrder: number, chapter: string }] }
// El frontend manda la lista COMPLETA con sortOrder consecutivo (0,1,2...)
// en el orden visible, igual que el reorder del catálogo de artefactos.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // budgetVersionId — no se usa, el id de cada partida basta
    const { items } = (await request.json()) as {
      items: { id: string; sortOrder: number; chapter?: string }[];
    };
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "items debe ser un array" },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      items.map((it) =>
        prisma.obraItem.update({
          where: { id: it.id },
          data: {
            sortOrder: it.sortOrder,
            // chapter solo si vino — un reorden dentro del mismo capítulo no
            // necesita tocarlo, pero mandarlo igual es inocuo (mismo valor).
            ...(it.chapter ? { chapter: it.chapter } : {}),
          },
        })
      )
    );

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (error) {
    console.error("Error reordering obra items:", error);
    return NextResponse.json({ error: "Error al reordenar" }, { status: 500 });
  }
}
