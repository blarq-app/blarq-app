/**
 * Renombrar línea y/o color de varios artefactos del catálogo de una vez.
 *
 * POST /api/catalogo/artefactos/relabel
 *   body: { ids: string[], line?: string|null, finish?: string|null }
 *
 * Lo usa el encabezado de cada subgrupo (línea+color) del catálogo: MJ edita
 * el nombre de la línea o del color y se aplica a todos los artefactos de ese
 * subgrupo. Sirve para corregir nombres ("ASIS"→"Asís") o para UNIFICAR
 * (renombrar el color de un subgrupo al de otro → quedan juntos).
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
    const patch: { line?: string | null; finish?: string | null } = {};
    if ("line" in data) patch.line = norm(data.line);
    if ("finish" in data) patch.finish = norm(data.finish);

    if (patch.line === undefined && patch.finish === undefined) {
      return NextResponse.json(
        { error: "Nada para renombrar" },
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
