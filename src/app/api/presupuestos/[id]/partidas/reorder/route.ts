import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Reordenar partidas (ObraItem) de una versión de presupuesto a mano.
// MJ arrastra las filas para armar el orden cronológico de la obra. Además
// del orden (sortOrder), una partida puede MOVERSE a otro capítulo cuando se
// la arrastra a la zona de ese capítulo (ej. metió "piso flotante" en
// Eléctricas y la corre a Terminaciones) — por eso aceptamos también el
// chapterId de cada fila y lo persistimos.
//
// Body: { items: [{ id: string, sortOrder: number, chapterId?: string }] }
// El frontend manda la lista COMPLETA con sortOrder consecutivo (0,1,2...)
// en el orden visible, igual que el reorder del catálogo de artefactos.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const { items } = (await request.json()) as {
      items: {
        id: string;
        sortOrder: number;
        chapterId?: string;
        subChapter?: string | null;
      }[];
    };
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "items debe ser un array" },
        { status: 400 }
      );
    }

    // Los capítulos destino tienen que ser de ESTA versión. Un id que no lo
    // sea se ignora (la partida se queda donde está) en vez de mandar la
    // partida a un capítulo de otro presupuesto.
    const propios = await prisma.obraChapter.findMany({
      where: { budgetVersionId },
      select: { id: true },
    });
    const capitulosValidos = new Set(propios.map((c) => c.id));

    await prisma.$transaction(
      items.map((it) =>
        prisma.obraItem.update({
          where: { id: it.id },
          data: {
            sortOrder: it.sortOrder,
            // chapterId solo si vino y es de esta versión — un reorden dentro
            // del mismo capítulo no necesita tocarlo.
            ...(it.chapterId && capitulosValidos.has(it.chapterId)
              ? { chapterId: it.chapterId }
              : {}),
            // subChapter (zona) puede ser null = sin zona, así que NO podemos
            // usar el truco de "solo si es truthy": distinguimos "vino en el
            // payload" (presente la propiedad) de "no vino". El arrastre lo
            // manda siempre para que dejar caer una partida en una zona la
            // guarde en esa zona (y en un área sin zona, la deje sin zona).
            ...("subChapter" in it ? { subChapter: it.subChapter ?? null } : {}),
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
