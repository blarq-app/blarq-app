/**
 * POST /api/catalogo/materiales/categorizar
 *
 * Dado el NOMBRE de un material, sugiere a qué categoría existente del
 * catálogo pertenece (usando Claude — ver suggestMaterialCategory). La lista
 * de categorías sale de la BD, no del cliente, para que el modelo elija
 * siempre entre rubros reales.
 *
 * Devuelve { category: string | null }. null = no se pudo adivinar (sin clave
 * de IA, o el modelo no acertó un rubro de la lista) → la UI deja que MJ
 * elija a mano. Nunca crea categorías nuevas.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { suggestMaterialCategory } from "@/lib/catalog/suggestCategory";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
// Lee el HTML de la tienda para sugerir categoría: mismo riesgo de tienda lenta.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { name } = await request.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Falta el nombre del material" },
        { status: 400 }
      );
    }

    const rows = await prisma.materialCatalog.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    const categories = rows.map((r) => r.category).filter(Boolean);

    const category = await suggestMaterialCategory(name, categories);
    return NextResponse.json({ category });
  } catch (error) {
    console.error("materiales/categorizar error:", error);
    return NextResponse.json(
      { error: "Error al sugerir la categoría" },
      { status: 500 }
    );
  }
}
