/**
 * Lectura de precio de tiendas Shopify (kitchenhouse.cl) vía su endpoint
 * público de producto.
 *
 * Por qué: igual que VTEX (ver fetchVtexPrice), estas tiendas dibujan el precio
 * por JavaScript, así que el scraper genérico solo veía UN precio (el de venta)
 * y lo cargaba como lista con 0% de descuento — nunca leía el precio tachado.
 *
 * Shopify expone cada producto como JSON en `<producto>.js`:
 *   GET https://<tienda>/products/<handle>.js
 *   → { price, compare_at_price, variants: [ { price, compare_at_price } ] }
 *
 * Los montos vienen en CENTAVOS (price 34099000 = $340.990). `compare_at_price`
 * es el precio lista original (el tachado); `price` es el de venta con el
 * descuento aplicado. Con esos dos sacamos el descuento del web
 * (discount = 1 − price/listPrice), igual que en MK.
 *
 * La lista de tiendas es EXPLÍCITA: solo se agregan las verificadas a mano
 * contra un producto real (mismo criterio que VTEX_PRICE_HOSTS).
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Tiendas Shopify con endpoint .js verificado con productos reales.
// kitchenhouse.cl: verificada 2026-07-14 (Teka; el horno NEO HBB 4460 responde
// compare_at_price 369990 / price 340990 = 8% dcto por la misma API).
const SHOPIFY_PRICE_HOSTS = ["kitchenhouse.cl"];

export interface ShopifyPrice {
  listPrice: number; // precio lista original (compare_at_price; el tachado)
  price: number; // precio actual de venta (con el descuento del web aplicado)
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ¿Es una URL de alguna tienda Shopify con endpoint de precios verificado?
export function isShopifyStoreUrl(url: string): boolean {
  const host = hostOf(url);
  return (
    host != null &&
    SHOPIFY_PRICE_HOSTS.some((h) => host === h || host.endsWith("." + h))
  );
}

// De https://kitchenhouse.cl/products/<handle>[?variant=...] arma el .js del
// producto: https://kitchenhouse.cl/products/<handle>.js
function productJsonUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/products\/([^/]+)/i);
    const handle = m?.[1];
    if (!handle) return null;
    return `${u.protocol}//${u.host}/products/${handle}.js`;
  } catch {
    return null;
  }
}

export async function fetchShopifyPrice(url: string): Promise<ShopifyPrice | null> {
  if (!isShopifyStoreUrl(url)) return null;
  const api = productJsonUrl(url);
  if (!api) return null;
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // Top-level = variante activa; si no viene, caemos a la primera variante.
    const variant = (data["variants"] as Array<Record<string, unknown>> | undefined)?.[0];
    const priceCents = Number(data["price"] ?? variant?.["price"]);
    const compareCents = Number(data["compare_at_price"] ?? variant?.["compare_at_price"]);
    if (!isFinite(priceCents) || priceCents <= 0) return null;
    const price = Math.round(priceCents / 100);
    // Si compare_at no viene (null → NaN) o es menor al price, no hay descuento:
    // usamos el price como lista (mismo criterio que fetchVtexPrice).
    const listPrice =
      isFinite(compareCents) && compareCents >= priceCents
        ? Math.round(compareCents / 100)
        : price;
    return { price, listPrice };
  } catch {
    return null;
  }
}
