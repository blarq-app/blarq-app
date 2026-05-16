/**
 * Auto-extract para el catálogo BLARQ (sin scope de proyecto).
 *
 * Mismo contrato que /api/proyectos/[id]/artefactos/extract pero sin la
 * envoltura de proyecto. Usado desde la página del catálogo cuando MJ
 * crea un item nuevo y quiere autocompletar pegando un link.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchArtefactoData } from "@/lib/catalog/fetchArtefactoData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "Parámetro 'url' requerido" },
      { status: 400 }
    );
  }
  try {
    const data = await fetchArtefactoData(url);
    if (!data) {
      return NextResponse.json(
        {
          error:
            "No se pudo abrir el link o el sitio no expone datos del producto. Cargá los campos manualmente.",
        },
        { status: 404 }
      );
    }
    if (!data.imageUrl && !data.name && !data.listPrice) {
      return NextResponse.json(
        {
          error:
            "El producto no tiene datos públicos en el sitio. Cargá los campos manualmente.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error extracting catalog artefacto:", error);
    return NextResponse.json(
      { error: "Error al extraer datos del producto" },
      { status: 500 }
    );
  }
}
