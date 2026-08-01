/**
 * Lectura ÚNICA del precio de un producto en la web.
 *
 * Por qué existe (auditoría 2026-07-31, docs/auditoria-artefactos-precios-2026-07.md):
 * había TRES formas distintas de leer un precio y solo una estaba bien.
 *   - El "Revisar precios" del catálogo leía lista + descuento por la API de la
 *     tienda (bien).
 *   - El "Comparar con la tienda web" de la cotización pedía lo mismo pero se
 *     quedaba SOLO con la lista y tiraba el precio de venta → los cambios de
 *     descuento eran invisibles (caso WC Atenas: la web pasó de 30% a 39%, la
 *     lista no se movió, y el modal dijo "coincide").
 *   - El autocompletar por link usaba únicamente el scraper genérico, que ve UN
 *     precio: si el producto estaba en oferta, guardaba la oferta como si fuera
 *     la lista, con 0% de descuento.
 *
 * Ahora todos los caminos entran por acá y reciben lo mismo.
 *
 * La distinción que importa es `discountKnown`:
 *   - true  → la tienda publica lista Y precio de venta por API (VTEX: mk.cl,
 *             ledstudio.cl; Shopify: kitchenhouse.cl). El descuento es real y se
 *             puede guardar con confianza.
 *   - false → tienda sin API conocida: el scraper ve un solo número y NO hay
 *             forma de saber si es lista o una oferta del día. Se devuelve como
 *             lista con descuento 0, pero marcado, para que quien lo use NO pise
 *             el descuento que ya tenga guardado y pueda avisarlo en pantalla.
 *
 * Para sumar una tienda: agregar el host a VTEX_PRICE_HOSTS o
 * SHOPIFY_PRICE_HOSTS (fetchVtexPrice.ts / fetchShopifyPrice.ts) después de
 * verificar a mano su API con un producto real.
 */

import { fetchArtefactoData } from "./fetchArtefactoData";
import { fetchVtexPrice, isVtexStoreUrl } from "./fetchVtexPrice";
import { fetchShopifyPrice, isShopifyStoreUrl } from "./fetchShopifyPrice";

export interface PrecioWeb {
  /** Precio lista (el "tachado" cuando hay oferta). Con IVA. */
  listPrice: number;
  /** Lo que la tienda cobra hoy = lista × (1 − descuento). */
  salePrice: number;
  /** Descuento vigente en la web, decimal 0..1. */
  discount: number;
  /**
   * ¿El descuento es confiable? false = tienda sin API de precios: el número
   * leído puede ser una oferta disfrazada de lista. Quien consuma esto NO debe
   * pisar un descuento ya guardado cuando viene en false.
   */
  discountKnown: boolean;
  source: "vtex" | "shopify" | "scraper";
}

/**
 * Trae el precio de hoy de un link de producto. Devuelve null si no se pudo
 * leer (link caído, tienda que no expone precio, timeout).
 */
export async function leerPrecioWeb(url: string): Promise<PrecioWeb | null> {
  if (!url || url.trim().length === 0) return null;

  if (isVtexStoreUrl(url)) {
    const vtex = await fetchVtexPrice(url);
    if (vtex) return armar(vtex.listPrice, vtex.price, true, "vtex");
    // Si la API falló, NO caemos al scraper: para estas tiendas el precio no
    // está en el HTML (lo dibuja JavaScript) y lo que devolvería sería basura.
    return null;
  }

  if (isShopifyStoreUrl(url)) {
    const sh = await fetchShopifyPrice(url);
    if (sh) return armar(sh.listPrice, sh.price, true, "shopify");
    return null;
  }

  // Tienda sin API conocida: un solo precio, sin saber si es lista u oferta.
  const data = await fetchArtefactoData(url);
  if (data?.listPrice != null && data.listPrice > 0) {
    return armar(data.listPrice, data.listPrice, false, "scraper");
  }
  return null;
}

function armar(
  listPrice: number,
  salePrice: number,
  discountKnown: boolean,
  source: PrecioWeb["source"]
): PrecioWeb {
  // Defensa: si la lista viene menor que el precio de venta (dato raro de la
  // tienda), tratamos el de venta como lista y damos descuento 0.
  const lista = listPrice >= salePrice ? listPrice : salePrice;
  const discount = lista > 0 ? Math.max(0, 1 - salePrice / lista) : 0;
  return {
    listPrice: Math.round(lista),
    salePrice: Math.round(salePrice),
    discount,
    discountKnown,
    source,
  };
}
