/**
 * Scraping liviano de precios desde Sodimac y Easy.
 *
 * Extraído de /api/catalogo/fetch-price/route.ts para poder reutilizar
 * desde el PUT del material (auto-fetch al cambiar el link) además del
 * endpoint público que invoca el botón "Actualizar precio" en la UI.
 */

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

export interface PriceResult {
  netPrice: number;
  priceIva: number;
}

function extractSodimacSku(url: string): string | null {
  const segments = url.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d{6,}$/.test(segments[i])) return segments[i];
  }
  return null;
}

async function fetchSodimacPrice(url: string): Promise<PriceResult | null> {
  const sku = extractSodimacSku(url);

  // Intento 1: producto público
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
          if (priceIva > 100)
            return { priceIva, netPrice: Math.round(priceIva / 1.19) };
        }
      }
    } catch {
      /* siguiente intento */
    }

    // Intento 2: API de catálogo
    try {
      const apiUrl = `https://www.sodimac.cl/catalog/category/v3/products?sku=${sku}&fetchPolicy=network-only`;
      const res = await fetch(apiUrl, {
        headers: { ...BROWSER_HEADERS, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const priceStr =
          data?.price?.["1"]?.["default"] ||
          data?.prices?.basePriceSales ||
          data?.prices?.basePriceReference;
        if (priceStr) {
          const priceIva = parseInt(String(priceStr).replace(/\D/g, ""), 10);
          if (priceIva > 100)
            return { priceIva, netPrice: Math.round(priceIva / 1.19) };
        }
      }
    } catch {
      /* continuar */
    }
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
        if (priceIva > 100)
          return { priceIva, netPrice: Math.round(priceIva / 1.19) };
      }
    }
  } catch {
    /* falló */
  }

  return null;
}

async function fetchEasyPrice(url: string): Promise<PriceResult | null> {
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
      if (priceIva > 100)
        return { priceIva, netPrice: Math.round(priceIva / 1.19) };
    }
  } catch {
    /* falló */
  }
  return null;
}

/**
 * Determina la fuente y delega al scraper apropiado. Devuelve null si la
 * URL no es de un sitio soportado o si el scraping falló.
 */
export async function fetchPriceFromUrl(
  url: string
): Promise<(PriceResult & { source: string }) | null> {
  if (!url) return null;
  const lower = url.toLowerCase();

  if (lower.includes("sodimac")) {
    const r = await fetchSodimacPrice(url);
    return r ? { ...r, source: "sodimac" } : null;
  }
  if (lower.includes("easy")) {
    const r = await fetchEasyPrice(url);
    return r ? { ...r, source: "easy" } : null;
  }
  return null;
}
