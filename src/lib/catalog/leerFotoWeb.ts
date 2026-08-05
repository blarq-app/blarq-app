/**
 * Lectura ÚNICA de la foto de un producto en la web, y chequeo de si la foto
 * que ya tenemos guardada sigue viva.
 *
 * Por qué existe (pendiente 132, 2026-08-05): el catálogo de artefactos NO
 * guarda la foto, guarda el LINK a la foto que vive en el servidor del
 * proveedor (mkchile.vtexassets.com, byp.vtexassets.com, cdn.shopify.com…).
 * Cuando la tienda reemplaza la imagen, cambia el id del archivo y el link
 * viejo queda en 404: el campo `imageUrl` sigue lleno pero la pantalla muestra
 * el recuadro vacío. Hasta ahora la foto entraba por un solo camino — el botón
 * "Extraer" AL CREAR el artefacto — así que una foto rota quedaba rota para
 * siempre (9 de 129 en la base viva al 2026-08-05).
 *
 * La cascada es la misma que la de `leerPrecioWeb` y por la misma razón: en las
 * tiendas VTEX/Shopify el dato bueno está en su API, no en el HTML. Se agrega
 * que la foto elegida se VERIFICA antes de devolverla, porque una tienda puede
 * publicar en su API un link que tampoco carga.
 */

import { fetchArtefactoData } from "./fetchArtefactoData";
import { fetchVtexImage, isVtexStoreUrl } from "./fetchVtexPrice";
import { fetchShopifyImage, isShopifyStoreUrl } from "./fetchShopifyPrice";

/**
 * ¿Este link de foto todavía carga como imagen?
 *
 * Se pide con HEAD (no baja el archivo, solo los encabezados) y se exige
 * `content-type: image/*`: VTEX responde 404 con un JSON de error cuando el id
 * de la imagen ya no existe, así que mirar solo el código no alcanzaría en
 * tiendas que devuelvan una página de error con 200.
 *
 * Las fotos embebidas (`data:…`) no viven en ningún servidor: siempre cargan.
 * Ante un timeout o un error de red devuelve `true` — o sea, no la damos por
 * rota: preferimos dejar la foto guardada antes que pisarla por un problema
 * momentáneo de conexión.
 */
export async function fotoSigueViva(imageUrl: string | null | undefined): Promise<boolean> {
  if (!imageUrl) return false;
  if (imageUrl.startsWith("data:")) return true;
  try {
    const r = await fetch(imageUrl, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404 || r.status === 410) return false;
    if (!r.ok) return true; // 403/429/500: la tienda nos frenó, no es foto muerta
    return (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return true;
  }
}

/**
 * Trae la foto que la tienda publica HOY para ese link de producto.
 * Devuelve null si no se pudo leer o si la foto leída tampoco carga.
 */
export async function leerFotoWeb(url: string): Promise<string | null> {
  if (!url || url.trim().length === 0) return null;

  const candidatos: (string | null)[] = [];

  if (isVtexStoreUrl(url)) candidatos.push(await fetchVtexImage(url));
  else if (isShopifyStoreUrl(url)) candidatos.push(await fetchShopifyImage(url));

  // El scraper genérico (og:image / JSON-LD) sirve de respaldo para las tiendas
  // con API y de camino único para el resto.
  if (!candidatos.some(Boolean)) {
    candidatos.push((await fetchArtefactoData(url))?.imageUrl ?? null);
  }

  for (const c of candidatos) {
    if (c && (await fotoSigueViva(c))) return c;
  }
  return null;
}
