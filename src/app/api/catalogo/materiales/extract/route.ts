/**
 * Auto-extract para el catálogo de MATERIALES.
 *
 * Igual que el de artefactos, pero para el alta de un material: MJ pega el
 * link del producto y la app rellena NOMBRE + PRECIO NETO (los materiales no
 * tienen foto, a diferencia de los artefactos).
 *
 * No escribe un scraper nuevo: COMPONE los dos motores que ya existen y son
 * de confianza, corriéndolos en paralelo:
 *   - fetchPriceFromUrl  → precio. Es el MISMO motor que usa "Actualizar
 *     precios" del catálogo de materiales. Importante para mK: el precio de
 *     mK no está en el HTML (lo dibuja JS), así que el precio sale de la API
 *     de catálogo VTEX, no del HTML.
 *   - fetchArtefactoData → nombre (vía JSON-LD / og:title del HTML).
 *
 * Si ninguno de los dos consigue datos (sitio no scrapeable, o Sodimac
 * bloqueando la IP de Vercel), devuelve 422 y la UI deja que MJ complete a
 * mano. Nunca inventamos un precio.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchPriceFromUrl } from "@/lib/catalog/fetchPrice";
import { fetchArtefactoData } from "@/lib/catalog/fetchArtefactoData";
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
    // En paralelo: el precio por el motor confiable de materiales y el nombre
    // por el extractor de productos. Cada uno puede fallar por su lado.
    const [priceResult, productData] = await Promise.all([
      fetchPriceFromUrl(url).catch(() => null),
      fetchArtefactoData(url).catch(() => null),
    ]);

    const netPrice = priceResult ? Math.round(priceResult.netPrice) : null;
    const priceIva = priceResult ? Math.round(priceResult.priceIva) : null;
    // Nombre prolijo: una sola línea, sin espacios duplicados.
    const name = productData?.name
      ? productData.name.replace(/\s+/g, " ").trim()
      : null;
    const source = priceResult?.source ?? productData?.source ?? null;

    // Si no se pudo leer NADA útil, que la UI caiga al alta manual.
    if (netPrice === null && !name) {
      return NextResponse.json(
        {
          error:
            "No se pudo leer el producto desde el link. Completá nombre y precio a mano.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ name, netPrice, priceIva, source });
  } catch (error) {
    console.error("materiales/extract error:", error);
    return NextResponse.json(
      { error: "Error al leer el producto desde el link" },
      { status: 500 }
    );
  }
}
