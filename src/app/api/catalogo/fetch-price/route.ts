import { NextRequest, NextResponse } from "next/server";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

// Extrae el SKU numérico desde una URL de Sodimac
// Soporta /product/123456/, /articulo/123456/nombre/789012, etc.
function extractSodimacSku(url: string): string | null {
  // Último segmento numérico largo (el SKU real suele ser el último número de 9 dígitos)
  const segments = url.split("/").filter(Boolean);
  // El SKU puede ser el último segmento o el penúltimo (si termina en /)
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d{6,}$/.test(segments[i])) return segments[i];
  }
  return null;
}

async function fetchSodimacPrice(
  url: string
): Promise<{ netPrice: number; priceIva: number } | null> {
  const sku = extractSodimacSku(url);

  // Intento 1: API JSON de Sodimac (no requiere JS ni cookies)
  if (sku) {
    try {
      const apiUrl = `https://www.sodimac.cl/sodimac-cl/product/${sku}/`;
      const res = await fetch(apiUrl, {
        headers: BROWSER_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/"price"\s*:\s*"?(\d{3,})"?/);
        if (match) {
          const priceIva = parseInt(match[1], 10);
          if (priceIva > 100) return { priceIva, netPrice: Math.round(priceIva / 1.19) };
        }
      }
    } catch { /* continuar con siguiente intento */ }

    // Intento 2: endpoint JSON de catálogo
    try {
      const apiUrl = `https://www.sodimac.cl/catalog/category/v3/products?sku=${sku}&fetchPolicy=network-only`;
      const res = await fetch(apiUrl, {
        headers: { ...BROWSER_HEADERS, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        // Busca precio en estructura del response
        const priceStr =
          data?.price?.["1"]?.["default"] ||
          data?.prices?.basePriceSales ||
          data?.prices?.basePriceReference;
        if (priceStr) {
          const priceIva = parseInt(String(priceStr).replace(/\D/g, ""), 10);
          if (priceIva > 100) return { priceIva, netPrice: Math.round(priceIva / 1.19) };
        }
      }
    } catch { /* continuar */ }
  }

  // Intento 3: URL original tal cual
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/"price"\s*:\s*"?(\d{3,})"?/);
      if (match) {
        const priceIva = parseInt(match[1], 10);
        if (priceIva > 100) return { priceIva, netPrice: Math.round(priceIva / 1.19) };
      }
    }
  } catch { /* falló */ }

  return null;
}

async function fetchEasyPrice(
  url: string
): Promise<{ netPrice: number; priceIva: number } | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/"price"\s*:\s*"?(\d{3,})"?/) ||
      html.match(/data-price="(\d+)"/) ||
      html.match(/itemprop="price"[^>]*content="([\d.]+)"/);
    if (match) {
      const raw = match[1].replace(/\./g, "").replace(/,/g, "");
      const priceIva = parseInt(raw, 10);
      if (priceIva > 100) return { priceIva, netPrice: Math.round(priceIva / 1.19) };
    }
  } catch { /* falló */ }
  return null;
}

// POST /api/catalogo/fetch-price
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL requerida" }, { status: 400 });
    }

    if (url.includes("sodimac")) {
      const result = await fetchSodimacPrice(url);
      if (result) {
        return NextResponse.json({ ...result, source: "sodimac" });
      }
      return NextResponse.json(
        { error: "No se pudo obtener el precio de Sodimac. Puede que el producto no esté disponible o el sitio esté bloqueando el acceso." },
        { status: 422 }
      );
    }

    if (url.includes("easy")) {
      const result = await fetchEasyPrice(url);
      if (result) {
        return NextResponse.json({ ...result, source: "easy" });
      }
      return NextResponse.json(
        { error: "No se pudo obtener el precio de Easy." },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { error: "Solo se soporta Sodimac y Easy por ahora" },
      { status: 422 }
    );
  } catch (error: any) {
    console.error("fetch-price error:", error);
    return NextResponse.json(
      { error: "Error al obtener el precio" },
      { status: 500 }
    );
  }
}
