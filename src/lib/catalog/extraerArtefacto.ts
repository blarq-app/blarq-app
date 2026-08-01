/**
 * Autocompletar de un artefacto a partir del link de la tienda.
 *
 * Combina las dos lecturas que hacen falta y que antes no se usaban juntas:
 *   - `fetchArtefactoData` (scraping del HTML): foto, nombre y marca.
 *   - `leerPrecioWeb` (API de la tienda cuando existe): precio LISTA real,
 *     precio de venta y descuento vigente.
 *
 * Por qué (auditoría 2026-07-31): el autocompletar usaba solo el scraper, que
 * ve UN precio — el de venta del día. Si el producto estaba en oferta, quedaba
 * guardado como si ese fuera el precio de lista, con 0% de descuento. Casos
 * reales en el catálogo: un horno guardado en $247.990 cuando la lista es
 * $519.990 con 52% de descuento, y una grifería en $109.990 cuando la lista es
 * $184.890 con 40%. Además de distorsionar el margen, hacía que un "Revisar
 * precios" posterior mostrara un salto enorme que parecía un error.
 *
 * `discountKnown` en false = tienda sin API de precios: el número puede ser una
 * oferta y no hay forma de saberlo. En ese caso `discountPercent` viene null y
 * quien consuma esto NO debe asumir 0%.
 */

import { fetchArtefactoData } from "./fetchArtefactoData";
import { leerPrecioWeb } from "./leerPrecioWeb";

export interface ArtefactoDesdeLink {
  source: string;
  imageUrl: string | null;
  name: string | null;
  brand: string | null;
  /** Precio lista (el "tachado" cuando hay oferta). */
  listPrice: number | null;
  /** Descuento vigente en la tienda, decimal 0..1. null = no se pudo saber. */
  discountPercent: number | null;
  /** Lo que la tienda cobra hoy = lista × (1 − dcto). */
  clientPrice: number | null;
  /** ¿La tienda publica lista y venta por separado? */
  discountKnown: boolean;
}

export async function extraerArtefactoDeLink(
  url: string
): Promise<ArtefactoDesdeLink | null> {
  // Las dos lecturas en paralelo: son independientes y ninguna debe hacer
  // fallar a la otra (una tienda puede dar precio por API y bloquear el HTML,
  // o al revés).
  const [data, web] = await Promise.all([
    fetchArtefactoData(url).catch(() => null),
    leerPrecioWeb(url).catch(() => null),
  ]);

  if (!data && !web) return null;

  return {
    source: data?.source ?? new URL(url).hostname.replace(/^www\./, ""),
    imageUrl: data?.imageUrl ?? null,
    name: data?.name ?? null,
    brand: data?.brand ?? null,
    // El precio de la API manda sobre el scrapeado: es el único que distingue
    // lista de oferta.
    listPrice: web?.listPrice ?? data?.listPrice ?? null,
    discountPercent: web?.discountKnown ? web.discount : null,
    clientPrice: web?.salePrice ?? data?.listPrice ?? null,
    discountKnown: web?.discountKnown ?? false,
  };
}
