/**
 * Revisión de precio online de un herraje del catálogo.
 *
 * A diferencia de artefactos (precio único por página, JSON-LD), los herrajes
 * de DPH son Shopify con VARIANTES por medida: el precio que nos interesa es el
 * de la variante exacta (su SKU), no el del producto. Por eso, para DPH pegamos
 * a `<producto>.json` de Shopify y matcheamos por SKU.
 *
 * HBT es Magento — todavía no implementado (Fase 1 cargó solo DPH). Devuelve
 * null para que "Revisar precios" lo marque como "sin precio" sin romperse.
 */

export type HerrajePriceResult = {
  costNet: number | null;
  source: "dph-shopify" | "hbt-magento" | null;
};

// De https://dph.cl/products/<handle> saca el .json de Shopify del producto.
function shopifyProductJsonUrl(referenceLink: string): string | null {
  try {
    const u = new URL(referenceLink);
    // /products/<handle>  → /products/<handle>.json
    const m = u.pathname.match(/\/products\/([^/]+)/);
    if (!m) return null;
    return `${u.origin}/products/${m[1]}.json`;
  } catch {
    return null;
  }
}

async function fetchDphVariantCost(
  referenceLink: string,
  sku: string | null,
): Promise<number | null> {
  const jsonUrl = shopifyProductJsonUrl(referenceLink);
  if (!jsonUrl) return null;
  try {
    const res = await fetch(jsonUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      // No cachear: queremos el precio de hoy.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      product?: { variants?: { sku?: string | null; price?: string }[] };
    };
    const variants = data.product?.variants ?? [];
    if (variants.length === 0) return null;
    // Match por SKU si lo tenemos; si no, no adivinamos (el producto tiene
    // muchas medidas y agarrar la primera daría un precio equivocado).
    const v = sku
      ? variants.find((x) => (x.sku ?? "").trim() === sku.trim())
      : variants.length === 1
        ? variants[0]
        : null;
    if (!v || v.price == null) return null;
    const n = Math.round(parseFloat(v.price));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function fetchHerrajePrice(item: {
  supplier: string;
  referenceLink: string | null;
  sku: string | null;
}): Promise<HerrajePriceResult> {
  if (!item.referenceLink) return { costNet: null, source: null };
  if (item.supplier === "DPH") {
    const costNet = await fetchDphVariantCost(item.referenceLink, item.sku);
    return { costNet, source: costNet != null ? "dph-shopify" : null };
  }
  // HBT (Magento) pendiente — tanda aparte.
  return { costNet: null, source: null };
}
