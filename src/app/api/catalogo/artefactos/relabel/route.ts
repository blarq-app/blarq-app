/**
 * Renombrar línea y/o color de varios artefactos del catálogo de una vez.
 *
 * POST /api/catalogo/artefactos/relabel
 *   body: { ids: string[], line?, finish?, tag?, subgroup? (string|null) }
 *
 * Lo usa el catálogo para aplicar un cambio a varios artefactos de una vez:
 *  - line/finish: corregir/unificar la línea o el color.
 *  - tag: mover los artefactos a otro tipo.
 *  - subgroup: la CARPETA manual (rediseño "carpetas a mano"). Mover un
 *    artefacto a otra carpeta, o renombrar la carpeta de todo un grupo, se hace
 *    seteando este campo. Es independiente de line/finish: cambiar la carpeta
 *    NO toca la línea ni el color, y editar la línea/color NO mueve de carpeta.
 *
 * Solo toca el catálogo (ArtefactoCatalog). NO toca cotizaciones ya hechas:
 * los ítems de presupuesto derivan su línea/color del nombre, no de acá.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    const ids: string[] = Array.isArray(data.ids) ? data.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Sin artefactos" }, { status: 400 });
    }

    // line/finish son opcionales: solo se actualiza la dimensión que viene en
    // el body. Vacío ("") se guarda como null (sin línea / sin color).
    const norm = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    const patch: {
      line?: string | null;
      finish?: string | null;
      tag?: string | null;
      subgroup?: string | null;
    } = {};
    if ("line" in data) patch.line = norm(data.line);
    if ("finish" in data) patch.finish = norm(data.finish);
    if ("tag" in data) patch.tag = norm(data.tag); // mover de tipo
    if ("subgroup" in data) patch.subgroup = norm(data.subgroup); // mover de carpeta

    if (
      patch.line === undefined &&
      patch.finish === undefined &&
      patch.tag === undefined &&
      patch.subgroup === undefined
    ) {
      return NextResponse.json(
        { error: "Nada para cambiar" },
        { status: 400 }
      );
    }

    const result = await prisma.artefactoCatalog.updateMany({
      where: { id: { in: ids } },
      data: patch,
    });

    return NextResponse.json({ count: result.count });
  } catch (error) {
    console.error("Error renombrando línea/color:", error);
    return NextResponse.json(
      { error: "Error al renombrar" },
      { status: 500 }
    );
  }
}
