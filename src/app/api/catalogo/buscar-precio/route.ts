import { NextRequest, NextResponse } from "next/server";
import { searchStoreProducts, VTEX_STORES } from "@/lib/catalog/fetchPrice";
import { requireSession } from "@/lib/apiAuth";

// POST /api/catalogo/buscar-precio — búsqueda en vivo de productos en una
// tienda, por texto. Devuelve candidatos con precio y stock de HOY para que
// MJ elija cuál linkear cuando el producto viejo se movió o quiere cambiar
// de fuente. Hoy solo tiendas VTEX (mK).
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { store, query } = await request.json();

    if (!store || typeof store !== "string") {
      return NextResponse.json({ error: "Tienda requerida" }, { status: 400 });
    }
    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Texto de búsqueda requerido" },
        { status: 400 }
      );
    }

    const supported = VTEX_STORES.some((s) => s.key === store);
    if (!supported) {
      return NextResponse.json(
        {
          error:
            "Esta tienda no soporta búsqueda en vivo. Pegá el link del producto y usá 'Obtener precio'.",
        },
        { status: 422 }
      );
    }

    const products = await searchStoreProducts(store, query);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("buscar-precio error:", error);
    return NextResponse.json(
      { error: "Error al buscar precios" },
      { status: 500 }
    );
  }
}
