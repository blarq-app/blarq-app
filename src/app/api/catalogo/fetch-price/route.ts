import { NextRequest, NextResponse } from "next/server";
import { fetchPriceFromUrl } from "@/lib/catalog/fetchPrice";

// POST /api/catalogo/fetch-price — scraping liviano de Sodimac/Easy.
// La lógica de scraping vive en src/lib/catalog/fetchPrice.ts para que se
// pueda reutilizar desde el PUT del material (auto-fetch al cambiar link).
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL requerida" }, { status: 400 });
    }

    const result = await fetchPriceFromUrl(url);
    if (result) {
      return NextResponse.json(result);
    }

    const lower = url.toLowerCase();
    if (lower.includes("sodimac")) {
      return NextResponse.json(
        {
          error:
            "No se pudo obtener el precio de Sodimac. Puede que el producto no esté disponible o el sitio esté bloqueando el acceso.",
        },
        { status: 422 }
      );
    }
    if (lower.includes("easy")) {
      return NextResponse.json(
        { error: "No se pudo obtener el precio de Easy." },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: "Solo se soporta Sodimac y Easy por ahora" },
      { status: 422 }
    );
  } catch (error) {
    console.error("fetch-price error:", error);
    return NextResponse.json(
      { error: "Error al obtener el precio" },
      { status: 500 }
    );
  }
}
