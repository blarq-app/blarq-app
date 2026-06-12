/**
 * Revisión masiva de precios e imágenes de artefactos contra las tiendas
 * online.
 *
 * Dado un conjunto de items (de un presupuesto), recorre los que tienen
 * un `referenceLink` cargado, baja la página del producto y devuelve un
 * "diff": precio actual vs precio en línea, imagen actual vs imagen en
 * línea, etc.
 *
 * NO escribe nada — solo lee y compara. La decisión de aplicar los
 * cambios la toma MJ desde el modal (o el flujo de duplicar, que aplica
 * los precios automáticamente).
 *
 * Se usa desde dos lugares:
 *   - GET .../artefactos/revisar-precios → modal "Revisar online".
 *   - POST .../artefactos/importar-de    → al duplicar de otra cotización,
 *     refresca precios automáticamente porque la cotización vieja casi
 *     siempre tiene precios desactualizados.
 */

import { fetchArtefactoData } from "./fetchArtefactoData";
import { fetchVtexPrice, isVtexStoreUrl } from "./fetchVtexPrice";

// Item mínimo que necesitamos para revisar — calza con ArtefactoItem.
export interface RevisableArtefacto {
  id: string;
  name: string;
  room: string;
  referenceLink: string | null;
  listPrice: number;
  imageUrl: string | null;
}

export interface ArtefactoOnlineDiff {
  itemId: string;
  name: string;
  room: string;
  referenceLink: string;
  currentListPrice: number;
  currentImageUrl: string | null;
  // Datos traídos de la tienda. null si no se pudo extraer nada.
  fetched: {
    listPrice: number | null;
    imageUrl: string | null;
    name: string | null;
    brand: string | null;
  } | null;
  // Mensaje de error legible cuando el link no respondió o el sitio no
  // expone datos. MJ usa esto para saber qué links tiene que recargar.
  error: string | null;
}

export interface RevisarArtefactosResult {
  diffs: ArtefactoOnlineDiff[];
  // Items que no tienen referenceLink — no se pueden revisar online.
  skippedNoLink: number;
}

// Corre `fn` sobre cada item respetando un máximo de tareas en paralelo.
// Bajar 30+ páginas de golpe satura la red y dispara rate-limits de las
// tiendas; de a 5 es un punto razonable.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Revisa una lista de artefactos contra las tiendas online.
 *
 * Solo procesa los que tienen `referenceLink`. Para cada uno baja la
 * página y arma el diff. Errores de red NO frenan al resto — quedan
 * registrados en `error` del item correspondiente.
 */
export async function revisarArtefactosOnline(
  items: RevisableArtefacto[]
): Promise<RevisarArtefactosResult> {
  const conLink = items.filter(
    (i) => i.referenceLink && i.referenceLink.trim().length > 0
  );
  const skippedNoLink = items.length - conLink.length;

  const diffs = await mapWithConcurrency(conLink, 5, async (item) => {
    const link = item.referenceLink as string;
    const diff: ArtefactoOnlineDiff = {
      itemId: item.id,
      name: item.name,
      room: item.room,
      referenceLink: link,
      currentListPrice: item.listPrice,
      currentImageUrl: item.imageUrl,
      fetched: null,
      error: null,
    };
    try {
      // En tiendas VTEX (mk, ledstudio) el precio NO viene en el HTML (lo
      // dibuja JavaScript) — se pregunta a su API. El scraper igual corre
      // para traer foto/nombre/marca, que sí están en el HTML.
      const vtexPrice = isVtexStoreUrl(link)
        ? await fetchVtexPrice(link)
        : null;
      const data = await fetchArtefactoData(link);
      if (
        !vtexPrice &&
        (!data || (!data.imageUrl && !data.name && !data.listPrice))
      ) {
        diff.error =
          "El link no respondió o el sitio no expone datos del producto.";
        return diff;
      }
      diff.fetched = {
        // El precio de la API manda sobre el scrapeado (es el vigente real).
        listPrice: vtexPrice?.listPrice ?? data?.listPrice ?? null,
        imageUrl: data?.imageUrl ?? null,
        name: data?.name ?? null,
        brand: data?.brand ?? null,
      };
    } catch {
      diff.error = "Error al abrir el link del producto.";
    }
    return diff;
  });

  return { diffs, skippedNoLink };
}
