/**
 * Tipos del catálogo de artefactos (por pestaña/subcategoría).
 *
 * GET  /api/catalogo/tipos                  — lista todos, ordenados.
 * POST /api/catalogo/tipos { subcategory, name } — crea uno nuevo (al final).
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const tipos = await prisma.artefactoTipo.findMany({
    orderBy: [{ subcategory: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(tipos);
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    const subcategory = String(data.subcategory || "").trim();
    const name = String(data.name || "").trim();
    if (!subcategory || !name) {
      return NextResponse.json(
        { error: "Falta pestaña o nombre" },
        { status: 400 }
      );
    }

    // El nuevo tipo va al final de su pestaña.
    const last = await prisma.artefactoTipo.findFirst({
      where: { subcategory },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = last ? last.sortOrder + 1 : 0;

    try {
      const tipo = await prisma.artefactoTipo.create({
        data: { subcategory, name, sortOrder },
      });
      return NextResponse.json(tipo);
    } catch (e: unknown) {
      // Violación del unique (subcategory, name): ya existe.
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code?: string }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: `Ya existe un tipo "${name}" en esta pestaña.` },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (error) {
    console.error("Error creando tipo:", error);
    return NextResponse.json({ error: "Error al crear tipo" }, { status: 500 });
  }
}
