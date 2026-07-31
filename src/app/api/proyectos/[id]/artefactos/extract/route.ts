/**
 * Endpoint para auto-extraer datos de un artefacto desde un URL de tienda.
 *
 * GET /api/proyectos/{id}/artefactos/extract?url=https://...
 *
 * Devuelve { source, imageUrl, name, brand, listPrice, discountPercent,
 * clientPrice, discountKnown } o null si no se pudo.
 *
 * El precio sale de la API de la tienda cuando existe (arreglo 2026-07-31):
 * el scraper solo ve el precio del día, así que un producto en oferta entraba
 * con el precio rebajado como si fuera la lista y 0% de descuento.
 *
 * Es un GET (no POST) intencionalmente para que sea cacheable a futuro
 * y para que el editor pueda dispararlo onBlur de un input sin pensar
 * en body de form.
 */

import { NextRequest, NextResponse } from "next/server";
import { extraerArtefactoDeLink } from "@/lib/catalog/extraerArtefacto";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "Parámetro 'url' requerido" },
      { status: 400 }
    );
  }
  try {
    const data = await extraerArtefactoDeLink(url);
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
