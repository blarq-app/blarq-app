/**
 * Lectura de precio de tiendas VTEX (mk.cl, ledstudio.cl) vía su API pública.
 *
 * Por qué: estas tiendas renderizan el precio por JavaScript, así que NO
 * está en el HTML que baja un scraper simple (fetchArtefactoData devolvía
 * "sin precio"). En cambio, la API de catálogo de VTEX entrega un JSON con
 * el precio actual (Price) y el precio lista original (ListPrice):
 *
 *   GET https://<tienda>/api/catalog_system/pub/products/search/<slug>/p
 *   → [ { items: [ { sellers: [ { commertialOffer: { Price, ListPrice } } ] } ] } ]
 *
 * Con esos dos números sacamos el descuento que la web tiene hoy
 * (discount = 1 − Price/ListPrice), que es justo lo que MJ quiere que
 * aparezca solo en la columna Dcto.
 *
 * Qué tiendas son VTEX lo decide `tiendas.ts` (pendiente 181): las de arranque
 * verificadas a mano — mk.cl 2026-06 (sesión precios artefactos), ledstudio.cl
 * 2026-06-12 (los 3 productos del catálogo responden Price/ListPrice) — y las
 * que la app aprende sola al extraer un producto, probando esta misma API
 * (`pareceVtex`).
 */

import { plataformaDe } from "./tiendas";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface VtexPrice {
  listPrice: number; // precio lista original (sin descuento)
  price: number; // precio actual de venta (con el descuento del web aplicado)
}

// Host normalizado (sin "www.") del URL, o null si el URL no parsea.
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ¿Es una URL de alguna tienda VTEX conocida (de arranque o aprendida)?
export async function isVtexStoreUrl(url: string): Promise<boolean> {
  return (await plataformaDe(url)) === "vtex";
}

// Extrae el "linkText" (slug) de una URL de producto VTEX:
//   https://www.mk.cl/<slug>/p  →  <slug>
function slugFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, ""); // sin barra final
    // Quita el sufijo "/p" típico de VTEX.
    const noP = path.replace(/\/p$/i, "");
    const slug = noP.split("/").filter(Boolean).pop();
    return slug ?? null;
  } catch {
    return null;
  }
}

// Pega a la API de catálogo de VTEX y devuelve el primer producto, o null.
// La misma respuesta trae el precio Y las fotos, por eso la comparten
// fetchVtexPrice y fetchVtexImage. No mira la lista de tiendas: eso lo hace
// quien llama (`leerPrecioWeb`), y `pareceVtex` necesita pegarle a una tienda
// que todavía no está en la lista.
async function fetchVtexProduct(url: string): Promise<Record<string, unknown> | null> {
  const host = hostOf(url);
  const slug = slugFromUrl(url);
  if (!host || !slug) return null;
  const api = `https://www.${host}/api/catalog_system/pub/products/search/${slug}/p`;
  try {
    const res = await fetch(api, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    // Producto dado de baja: la API responde 200 con un arreglo vacío.
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Foto principal del producto según la API de VTEX.
 *
 * La foto que guarda el catálogo es un LINK al servidor del proveedor, no la
 * imagen. Cuando MK reemplaza la foto cambia el id del archivo y el link viejo
 * queda en 404 (el catálogo muestra el recuadro vacío). Con esto se vuelve a
 * pedir la de hoy sin depender de que la página publique og:image.
 */
export async function fetchVtexImage(url: string): Promise<string | null> {
  const product = await fetchVtexProduct(url);
  if (!product) return null;
  const items = product["items"] as Array<Record<string, unknown>> | undefined;
  const images = items?.[0]?.["images"] as Array<Record<string, unknown>> | undefined;
  const first = images?.[0]?.["imageUrl"];
  if (typeof first !== "string" || first.length === 0) return null;
  // La API todavía entrega el CDN viejo de VTEX (<tienda>.vteximg.com.br). El
  // actual, y el que ya usan casi todas las fotos del catálogo, es
  // <tienda>.vtexassets.com — mismo id de archivo, misma ruta. Guardamos esa
  // para no ir dejando links en el dominio que VTEX está retirando.
  // (Verificado 2026-08-05 contra mkchile y byp: los dos hosts sirven el mismo
  // archivo con 200 image/jpeg.)
  return first.replace(/\.vteximg\.com\.br\//, ".vtexassets.com/");
}

/**
 * ¿Esta tienda expone la API de VTEX para ESTE producto? Es la verificación
 * que antes se hacía a mano por tienda: si la API responde con un precio
 * válido, la tienda es VTEX y `tiendas.ts` la anota como tal.
 */
export async function pareceVtex(url: string): Promise<boolean> {
  return (await fetchVtexPrice(url)) != null;
}

export async function fetchVtexPrice(url: string): Promise<VtexPrice | null> {
  const product = await fetchVtexProduct(url);
  if (!product) return null;
  // Navegación defensiva por la estructura de VTEX.
  const items = product["items"] as Array<Record<string, unknown>> | undefined;
  const sellers = items?.[0]?.["sellers"] as
    | Array<Record<string, unknown>>
    | undefined;
  const co = sellers?.[0]?.["commertialOffer"] as
    | Record<string, unknown>
    | undefined;
  if (!co) return null;
  const price = Number(co["Price"]);
  const listPrice = Number(co["ListPrice"]);
  if (!isFinite(price) || price <= 0) return null;
  return {
    price: Math.round(price),
    // Si ListPrice no viene o es menor al Price, usamos el Price como lista.
    listPrice:
      isFinite(listPrice) && listPrice >= price
        ? Math.round(listPrice)
        : Math.round(price),
  };
}
