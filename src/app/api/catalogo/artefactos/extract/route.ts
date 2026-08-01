/**
 * Auto-extract para el catálogo BLARQ (sin scope de proyecto).
 *
 * Mismo contrato que /api/proyectos/[id]/artefactos/extract pero sin la
 * envoltura de proyecto. Usado desde la página del catálogo cuando MJ
 * crea un item nuevo y quiere autocompletar pegando un link.
 *
 * Devuelve foto/nombre/marca + precio LISTA, descuento vigente y precio de
 * venta. Desde el arreglo 2026-07-31 el precio sale de la API de la tienda
 * (cuando existe) y no del scraper: antes, un producto en oferta se guardaba
 * con el precio rebajado como si fuera la lista, con 0% de descuento.
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
