/**
 * Endpoint para auto-extraer datos de un artefacto desde un URL de tienda.
 *
 * GET /api/proyectos/{id}/artefactos/extract?url=https://...
 *
 * Llama al scraper de lib/catalog/fetchArtefactoData y devuelve
 * { source, imageUrl, name, brand, listPrice } o null si no se pudo.
 *
 * Es un GET (no POST) intencionalmente para que sea cacheable a futuro
 * y para que el editor pueda dispararlo onBlur de un input sin pensar
 * en body de form.
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
            "No se pudo abrir el link o el sitio no expone datos del producto. Pegá la URL de imagen manualmente.",
        },
        { status: 404 }
      );
    }
    // Si el scraper no pudo extraer ningún dato útil (todo null), también
    // tratamos como no-encontrado para que la UI muestre el fallback manual.
    if (!data.imageUrl && !data.name && !data.listPrice) {
      return NextResponse.json(
        {
          error:
            "El producto no tiene datos públicos en el sitio (puede estar descontinuado). Cargá los campos manualmente.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error extracting artefacto:", error);
    return NextResponse.json(
      { error: "Error al extraer datos del producto" },
      { status: 500 }
    );
  }
}
