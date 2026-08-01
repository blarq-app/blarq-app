/**
 * Revisión masiva de precios e imágenes de artefactos contra las tiendas
 * online.
 *
 * Dado un conjunto de items (de un presupuesto), recorre los que tienen
 * un `referenceLink` cargado, baja la página del producto y devuelve un
 * "diff": precio lista, DESCUENTO y precio a cliente actuales vs los de la
 * tienda hoy, más la imagen.
 *
 * NO escribe nada — solo lee y compara. La decisión de aplicar los
 * cambios la toma MJ desde el modal (o el flujo de duplicar, que aplica
 * los precios automáticamente).
 *
 * Se usa desde dos lugares:
 *   - GET .../artefactos/revisar-precios → modal "Comparar con la tienda web".
 *   - POST .../artefactos/importar-de    → al duplicar de otra cotización,
 *     refresca precios automáticamente porque la cotización vieja casi
 *     siempre tiene precios desactualizados.
 *
 * ── Arreglo 2026-07-31 (auditoría de precios) ────────────────────────────
 * Antes esta librería pedía el precio a la API de la tienda y se quedaba SOLO
 * con la lista, descartando el precio de venta. Resultado: los cambios de
 * DESCUENTO eran invisibles. Caso real: el WC Atenas pasó de 30% a 39% en
 * mk.cl sin mover la lista, y el modal informaba "coincide". Además no conocía
 * Kitchen House (Shopify), así que ahí leía la oferta como si fuera lista.
 * Ahora todo pasa por `leerPrecioWeb`, la misma lectura que usa el catálogo.
 */

import { fetchArtefactoData } from "./fetchArtefactoData";
import { leerPrecioWeb } from "./leerPrecioWeb";

// Item mínimo que necesitamos para revisar — calza con ArtefactoItem.
export interface RevisableArtefacto {
  id: string;
  name: string;
  room: string;
  referenceLink: string | null;
  listPrice: number;
  // Descuento guardado en la línea (decimal 0..1). Se compara contra el de la
  // tienda para poder mostrar "30% → 39%".
  discountPercent?: number | null;
  // Lo que hoy paga el cliente por esta línea (unitario). Si no viene, se
  // deriva de lista × (1 − dcto).
  clientPrice?: number | null;
  imageUrl: string | null;
  // "Despegado del catálogo": MJ editó el precio a mano en esta cotización.
  // Solo viaja hasta la UI para avisar — la revisión igual lo compara.
  // Opcional porque el flujo de duplicar (importar-de) no lo necesita.
  priceOverridden?: boolean;
}

export interface ArtefactoOnlineDiff {
  itemId: string;
  name: string;
  room: string;
  referenceLink: string;
  // Lo que la línea tiene hoy:
  currentListPrice: number;
  currentDiscount: number; // decimal 0..1
  currentClientPrice: number; // lo que paga el cliente hoy (unitario)
  currentImageUrl: string | null;
  // El precio de esta línea fue editado a mano (no sigue al catálogo).
  priceOverridden: boolean;
  // Datos traídos de la tienda. null si no se pudo extraer nada.
  fetched: {
    listPrice: number | null;
    // Descuento de la tienda hoy (decimal 0..1) y precio de venta resultante.
    discount: number | null;
    clientPrice: number | null;
    // false = la tienda no publica lista y venta por separado: el descuento no
    // se puede saber y NO debe pisar el guardado (solo se aplica la lista).
    discountKnown: boolean;
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
    const currentDiscount = item.discountPercent ?? 0;
    const diff: ArtefactoOnlineDiff = {
      itemId: item.id,
      name: item.name,
      room: item.room,
      referenceLink: link,
      currentListPrice: item.listPrice,
      currentDiscount,
      currentClientPrice:
        item.clientPrice ?? Math.round(item.listPrice * (1 - currentDiscount)),
      currentImageUrl: item.imageUrl,
      priceOverridden: item.priceOverridden ?? false,
      fetched: null,
      error: null,
    };
    try {
      // El precio va por la lectura única (API de la tienda cuando existe); el
      // scraper corre igual para traer foto / nombre / marca, que sí están en
      // el HTML aunque el precio no.
      const [web, data] = await Promise.all([
        leerPrecioWeb(link),
        fetchArtefactoData(link).catch(() => null),
      ]);
      if (!web && (!data || (!data.imageUrl && !data.name && !data.listPrice))) {
        diff.error =
          "El link no respondió o el sitio no expone datos del producto.";
        return diff;
      }
      diff.fetched = {
        listPrice: web?.listPrice ?? data?.listPrice ?? null,
        discount: web?.discount ?? null,
        clientPrice: web?.salePrice ?? data?.listPrice ?? null,
        discountKnown: web?.discountKnown ?? false,
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
