/**
 * Guardar el orden manual de los subgrupos (línea + color) dentro de un tipo.
 *
 * PATCH /api/catalogo/artefactos/subgroup-order
 *   body: {
 *     subcategory: string,        // pestaña (sanitario | cocina | iluminacion)
 *     tag: string,                // nombre del tipo; "" = sin tipo
 *     items: { line: string; finish: string; sortOrder: number }[]
 *   }
 *
 * Cada item es un subgrupo (su línea y color; "" cuando no tiene). Se hace
 * upsert por la clave natural (subcategory, tag, line, finish): si la fila ya
 * existe se actualiza su sortOrder, si no se crea. Los subgrupos que no tengan
 * fila caen a orden alfabético en la UI (fallback) — por eso solo guardamos los
 * que MJ realmente reordenó.
 *
 * Tabla aparte (ArtefactoSubgroupOrder) a propósito: el orden de los subgrupos
 * NO puede colgarse del sortOrder de los artefactos (ver schema).
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PATCH(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    const subcategory =
      typeof data.subcategory === "string" ? data.subcategory : "";
    const tag = typeof data.tag === "string" ? data.tag : "";
    const items: { line: string; finish: string; sortOrder: number }[] =
      Array.isArray(data.items) ? data.items : [];

    if (!subcategory) {
      return NextResponse.json(
        { error: "Falta la subcategoría" },
        { status: 400 }
      );
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Sin subgrupos" }, { status: 400 });
    }

    const norm = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";

    await prisma.$transaction(
      items.map((it) => {
        const line = norm(it.line);
        const finish = norm(it.finish);
        const sortOrder =
          Number.isFinite(it.sortOrder) ? Math.trunc(it.sortOrder) : 0;
        return prisma.artefactoSubgroupOrder.upsert({
          where: {
            subcategory_tag_line_finish: { subcategory, tag, line, finish },
          },
          create: { subcategory, tag, line, finish, sortOrder },
          update: { sortOrder },
        });
      })
    );

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (error) {
    console.error("Error guardando orden de subgrupos:", error);
    return NextResponse.json(
      { error: "Error al guardar el orden de los subgrupos" },
      { status: 500 }
    );
  }
}
