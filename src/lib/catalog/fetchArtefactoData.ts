/**
 * Scraping liviano de datos de un artefacto desde tiendas online.
 *
 * Dado un URL de un producto, intenta extraer:
 *   - imageUrl  (foto principal del producto)
 *   - name      (nombre del producto, ej. "WC ATENAS Two Piece")
 *   - brand     (marca, ej. "KLIPEN")
 *   - listPrice (precio lista en pesos chilenos, con IVA)
 *
 * Soporta:
 *   - mk.cl
 *   - sodimac.cl
 *   - easy.cl
 *
 * Otros sitios (Falabella, Ripley, casamusa) devuelven null — para esos,
 * MJ pega los campos manual. La idea es cubrir el ~80% más común sin
 * meter una dependencia de scraping pesada (Puppeteer, etc).
 *
 * OJO: en tiendas VTEX (mk.cl, ledstudio.cl) el PRECIO no está en el HTML
 * (lo dibuja JavaScript) — para precio usar fetchVtexPrice; este scraper
 * sirve igual para foto/nombre/marca.
 *
 * Estrategia general:
 *   - Fetch del HTML con User-Agent de navegador.
 *   - Buscar JSON-LD (<script type="application/ld+json">) que casi todos
 *     los e-commerces incluyen con datos estructurados de Product. Es lo
 *     más estable cuando funciona.
 *   - Si no, regex sobre OpenGraph meta tags (og:image, og:title) y
 *     patrones específicos por sitio.
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

export interface ArtefactoExtracted {
  source: string;
  imageUrl: string | null;
  name: string | null;
  brand: string | null;
  listPrice: number | null;
}

// Decodifica entidades HTML básicas que aparecen en meta tags.
//
// Las numéricas van PRIMERO y `&amp;` al final, a propósito: así un `&amp;#39;`
// del sitio termina como el texto `&#39;` (que es lo que quiso decir) y no como
// una comilla. hbt.cl (Magento) escribe el og:title todo en entidades hex
// —"BISAGRA&#X20;CLIPTOP&#X20;95&#XB0;"— y sin esto ese pegote entraba tal cual
// al nombre y al detalle del herraje.
function decode(s: string): string {
  const codePoint = (n: number) => {
    try {
      return String.fromCodePoint(n);
    } catch {
      return ""; // fuera de rango: mejor comerse el caracter que reventar
    }
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&amp;/g, "&")
    .trim();
}

// Saca el primer match de un campo de un objeto JSON-LD (puede ser objeto
// solo o array). Retorna el valor del primer Product encontrado.
function findProductLd(html: string): Record<string, unknown> | null {
  const ldMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const type = c?.["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
          return c as Record<string, unknown>;
        }
        // Algunos sitios envuelven en @graph
        if (Array.isArray(c?.["@graph"])) {
          for (const g of c["@graph"]) {
            const gt = g?.["@type"];
            if (gt === "Product" || (Array.isArray(gt) && gt.includes("Product"))) {
              return g as Record<string, unknown>;
            }
          }
        }
      }
    } catch {
      /* JSON inválido en ese script, siguiente */
    }
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  if (m) return decode(m[1]);
  // Probar al revés (content antes de property/name)
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2 ? decode(m2[1]) : null;
}

function parsePriceFromHtml(html: string): number | null {
  // JSON-LD price (lo más confiable)
  const ld = findProductLd(html);
  if (ld) {
    const offers = ld.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const off = Array.isArray(offers) ? offers[0] : offers;
    const priceStr = off?.price ?? off?.lowPrice;
    if (priceStr) {
      const n = parseFloat(String(priceStr).replace(/\./g, "").replace(/,/g, "."));
      if (!isNaN(n) && n > 100) return Math.round(n);
    }
  }
  // og:price:amount
  const og = metaContent(html, "og:price:amount") || metaContent(html, "product:price:amount");
  if (og) {
    const n = parseFloat(og.replace(/\./g, "").replace(/,/g, "."));
    if (!isNaN(n) && n > 100) return Math.round(n);
  }
  // Patrón genérico "price": 12345
  const m = html.match(/"price"\s*:\s*"?(\d{3,})"?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 100) return n;
  }
  return null;
}

function extractGenericProductData(
  url: string,
  html: string,
  source: string
): ArtefactoExtracted {
  const ld = findProductLd(html);

  let imageUrl: string | null = null;
  let name: string | null = null;
  let brand: string | null = null;

  if (ld) {
    const img = ld.image;
    if (typeof img === "string") imageUrl = img;
    else if (Array.isArray(img) && img.length > 0)
      imageUrl = typeof img[0] === "string" ? img[0] : (img[0] as { url?: string })?.url ?? null;
    else if (typeof img === "object" && img !== null)
      imageUrl = (img as { url?: string }).url ?? null;

    if (typeof ld.name === "string") name = decode(ld.name);

    const ldBrand = ld.brand;
    if (typeof ldBrand === "string") brand = decode(ldBrand);
    else if (typeof ldBrand === "object" && ldBrand !== null)
      brand = decode(String((ldBrand as { name?: string }).name ?? ""));
  }

  if (!imageUrl) imageUrl = metaContent(html, "og:image");
  if (!name) name = metaContent(html, "og:title");
  if (!brand) brand = metaContent(html, "product:brand");

  // Si imageUrl es relativa, resolverla contra la URL base
  if (imageUrl && imageUrl.startsWith("/")) {
    try {
      const u = new URL(url);
      imageUrl = `${u.protocol}//${u.host}${imageUrl}`;
    } catch {
      /* mantener como está */
    }
  }

  return {
    source,
    imageUrl,
    name: name || null,
    brand: brand || null,
    listPrice: parsePriceFromHtml(html),
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      // 25 s, no 12. hbt.cl (Magento) tarda ~10 s medidos en el primer byte y
      // manda ~390 KB: con 12 s alcanzaba raspando y cualquier día malo del
      // proveedor daba "no se pudo abrir el link" con un link sano. El techo
      // real de la request lo pone el maxDuration de la ruta (60 s), así que
      // 25 s deja margen sin riesgo de que la función se corte por su cuenta.
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Extrae datos de cualquier URL de producto.
 *
 * Estrategia: el scraper es universal. Para cualquier URL, baja el HTML
 * e intenta JSON-LD Product → og:image/og:title → regex de price. Si el
 * sitio expone alguno de esos (que es lo más común hoy en e-commerce),
 * funciona automáticamente. Si no, devuelve null y la UI cae al fallback
 * manual.
 *
 * Probados y funcionando:
 *   - mk.cl, sodimac.cl, easy.cl
 *   - chc.cl, byp.cl, ledstudio.cl (VTEX/JSON-LD)
 *   - ledconcept.cl (WooCommerce/JSON-LD)
 *
 * El "source" se infiere del hostname solo para metadata informativa.
 */
function inferSource(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "unknown";
  }
}

export async function fetchArtefactoData(
  url: string
): Promise<ArtefactoExtracted | null> {
  if (!url) return null;
  const source = inferSource(url);
  const html = await fetchHtml(url);
  if (!html) return null;
  return extractGenericProductData(url, html, source);
}
