import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { soloPrincipales } from "@/lib/presupuesto/muebleItems";

/**
 * Plantillas de muebles (capítulos tipo y partidas tipo). Ver schema.prisma.
 *
 * GET  /api/catalogo/plantillas-muebles
 *   { capitulos: [{ id, name, items: [{ id, name, kind, details… }] }],
 *     partidas:  [ …partidas sueltas (sin capítulo tipo)… ] }
 *
 * POST /api/catalogo/plantillas-muebles
 *   { tipo: "capitulo", chapterId, name }  → guarda un capítulo REAL de una
 *       cotización como capítulo tipo, con sus partidas base (las
 *       alternativas para el cliente no van) y los componentes de cada una.
 *   { tipo: "partida", itemId, name }      → guarda una partida real como
 *       partida tipo suelta.
 *   Si ya existe una plantilla con ese nombre, se REEMPLAZA (así "guardar de
 *   nuevo" desde una partida mejor armada actualiza la plantilla).
 *   Nunca se guardan precios ni cantidades: son de cada proyecto.
 */
export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const include = { details: { orderBy: { sortOrder: "asc" as const } } };
  const [capitulos, partidas] = await Promise.all([
    prisma.muebleChapterTemplate.findMany({
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" }, include } },
    }),
    prisma.muebleItemTemplate.findMany({
      where: { chapterTemplateId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include,
    }),
  ]);
  return NextResponse.json({ capitulos, partidas });
}

type ItemReal = {
  name: string;
  kind: string;
  descriptionGeneral: string | null;
  supplier: string | null;
  utilityPercentage: number;
  sortOrder: number;
  alternativeOfId: string | null;
  details: { name: string; material: string; sortOrder: number }[];
};

function plantillaDe(it: ItemReal, sortOrder: number) {
  return {
    name: it.name,
    kind: it.kind,
    descriptionGeneral: it.descriptionGeneral,
    supplier: it.supplier,
    utilityPercentage: it.utilityPercentage,
    sortOrder,
    details: {
      create: it.details
        // Componentes vacíos (nombre y materialidad en blanco) no aportan.
        .filter((d) => d.name.trim() || d.material.trim())
        .map((d, i) => ({ name: d.name, material: d.material, sortOrder: i })),
    },
  };
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    const name = String(data.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "La plantilla necesita un nombre" }, { status: 400 });

    if (data.tipo === "capitulo") {
      const ch = await prisma.muebleChapter.findUnique({
        where: { id: String(data.chapterId) },
        include: { items: { orderBy: { sortOrder: "asc" }, include: { details: { orderBy: { sortOrder: "asc" } } } } },
      });
      if (!ch) return NextResponse.json({ error: "Capítulo no encontrado" }, { status: 404 });
      const base = soloPrincipales(ch.items);
      // Reemplazo por nombre: se borra la anterior (cascade a partidas y
      // componentes) y se crea de nuevo.
      const existente = await prisma.muebleChapterTemplate.findUnique({ where: { name } });
      const maxSort = await prisma.muebleChapterTemplate.aggregate({ _max: { sortOrder: true } });
      const creado = await prisma.$transaction(async (tx) => {
        if (existente) await tx.muebleChapterTemplate.delete({ where: { id: existente.id } });
        return tx.muebleChapterTemplate.create({
          data: {
            name,
            sortOrder: existente?.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
            items: { create: base.map((it, i) => plantillaDe(it, i)) },
          },
          include: { items: { include: { details: true } } },
        });
      });
      return NextResponse.json({ tipo: "capitulo", plantilla: creado, reemplazo: !!existente });
    }

    if (data.tipo === "partida") {
      const it = await prisma.muebleItem.findUnique({
        where: { id: String(data.itemId) },
        include: { details: { orderBy: { sortOrder: "asc" } } },
      });
      if (!it) return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
      const existente = await prisma.muebleItemTemplate.findFirst({ where: { chapterTemplateId: null, name } });
      const creado = await prisma.$transaction(async (tx) => {
        if (existente) await tx.muebleItemTemplate.delete({ where: { id: existente.id } });
        return tx.muebleItemTemplate.create({
          data: { ...plantillaDe(it, existente?.sortOrder ?? 0), name },
          include: { details: true },
        });
      });
      return NextResponse.json({ tipo: "partida", plantilla: creado, reemplazo: !!existente });
    }

    return NextResponse.json({ error: "tipo debe ser 'capitulo' o 'partida'" }, { status: 400 });
  } catch (error) {
    console.error("Error guardando plantilla de muebles:", error);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}
