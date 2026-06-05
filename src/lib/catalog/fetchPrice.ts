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

// ── VTEX (mK y otras tiendas chilenas sobre la plataforma VTEX) ─────
//
// A diferencia de Sodimac/Easy (que scrapeamos del HTML con regex frágil),
// las tiendas VTEX exponen una API pública de catálogo que devuelve precio
// y stock en JSON limpio:
//   /api/catalog_system/pub/products/search?ft=<texto>      → búsqueda
//   /api/catalog_system/pub/products/search/<slug>/p        → por link
//
// Solo mK está VERIFICADA hoy (probado 2026-06-05). Construmart, Imperial,
// Easy y Chilemat NO responden esta API (devuelven HTML). Sumar otra tienda
// VTEX = agregar una línea a VTEX_STORES y confirmar que su /api/catalog_system
// responde JSON.

export interface VtexStore {
  key: string; // identificador interno; coincide con MaterialPriceOffer.store
  label: string; // visible en la UI
  host: string; // dominio con www, sin protocolo
}

export const VTEX_STORES: VtexStore[] = [
  { key: "mk", label: "mK", host: "www.mk.cl" },
];

function vtexStoreFromUrl(url: string): VtexStore | null {
  const lower = url.toLowerCase();
  return (
    VTEX_STORES.find((s) => lower.includes(s.host.replace(/^www\./, ""))) ?? null
  );
}

export function vtexStoreByKey(key: string): VtexStore | null {
  return VTEX_STORES.find((s) => s.key === key) ?? null;
}

/** Producto candidato devuelto por la búsqueda en vivo de una tienda. */
export interface StoreProduct {
  store: string; // key de la tienda
  productName: string;
  refId: string | null; // referencia/SKU de la tienda
  price: number; // precio c/IVA tal como aparece en la web
  priceNet: number; // neto = round(price / 1.19)
  available: boolean; // hay stock
  url: string | null;
}

// Tipos mínimos del JSON de VTEX (solo los campos que usamos).
interface VtexOffer {
  Price?: number;
  AvailableQuantity?: number;
}
interface VtexItem {
  nameComplete?: string;
  referenceId?: { Key: string; Value: string }[];
  sellers?: { commertialOffer?: VtexOffer }[];
}
interface VtexProduct {
  productName?: string;
  productReference?: string;
  linkText?: string;
  link?: string;
  items?: VtexItem[];
}

function mapVtexProduct(store: VtexStore, p: VtexProduct): StoreProduct | null {
  const item = p?.items?.[0];
  const offer = item?.sellers?.[0]?.commertialOffer;
  const price = offer?.Price;
  if (!price || price < 100) return null;
  const refId =
    item?.referenceId?.find((r) => r.Key === "RefId")?.Value ??
    p?.productReference ??
    null;
  return {
    store: store.key,
    productName: p?.productName ?? item?.nameComplete ?? "Producto",
    refId,
    price,
    priceNet: Math.round(price / 1.19),
    available: (offer?.AvailableQuantity ?? 0) > 0,
    url: p?.linkText
      ? `https://${store.host}/${p.linkText}/p`
      : (p?.link ?? null),
  };
}

async function vtexSearch(
  store: VtexStore,
  query: string,
  max = 8
): Promise<StoreProduct[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://${store.host}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=${max - 1}`;
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    // VTEX devuelve 206 (Partial Content) cuando hay paginación: es válido.
    if (!res.ok && res.status !== 206) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((p: VtexProduct) => mapVtexProduct(store, p))
      .filter((x): x is StoreProduct => x !== null);
  } catch {
    return [];
  }
}

async function fetchVtexPriceByUrl(
  store: VtexStore,
  url: string
): Promise<PriceResult | null> {
  // El link de un producto VTEX termina en .../{slug}/p
  const m = url.match(/\/([^/]+)\/p(?:[?#]|$)/i);
  const slug = m?.[1];
  if (!slug) return null;
  try {
    const apiUrl = `https://${store.host}/api/catalog_system/pub/products/search/${slug}/p`;
    const res = await fetch(apiUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok && res.status !== 206) return null;
    const data = await res.json();
    const mapped = Array.isArray(data) ? mapVtexProduct(store, data[0]) : null;
    if (mapped) return { priceIva: mapped.price, netPrice: mapped.priceNet };
  } catch {
    /* el producto pudo haberse movido: el link viejo ya no resuelve */
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
  const vtex = vtexStoreFromUrl(url);
  if (vtex) {
    const r = await fetchVtexPriceByUrl(vtex, url);
    return r ? { ...r, source: vtex.key } : null;
  }
  return null;
}

/**
 * Búsqueda en vivo de productos en una tienda, por texto. Devuelve candidatos
 * con su precio y stock de HOY, para que MJ elija cuál linkear cuando el
 * producto viejo ya no existe o quiere cambiar de fuente.
 *
 * Hoy solo las tiendas VTEX (mK) soportan búsqueda en vivo. Sodimac/Easy se
 * siguen actualizando pegando el link directo (fetchPriceFromUrl).
 */
export async function searchStoreProducts(
  storeKey: string,
  query: string
): Promise<StoreProduct[]> {
  const vtex = vtexStoreByKey(storeKey);
  if (vtex) return vtexSearch(vtex, query);
  return [];
}
