/**
 * ¿Dos URLs apuntan a la MISMA foto?
 *
 * Por qué existe (2026-08-02): MK y LED Studio migraron su CDN de imágenes de
 * `<tienda>.vteximg.com.br` a `<tienda>.vtexassets.com`. El archivo es
 * idéntico — mismo id, mismo nombre — pero la URL cambió de dominio:
 *
 *   https://mkchile.vteximg.com.br/arquivos/ids/7296954/GKL-03-0061_1.jpg
 *   https://mkchile.vtexassets.com/arquivos/ids/7296954/GKL-03-0061_1.jpg
 *
 * Comparando las URLs como texto, el modal "Comparar con la tienda web" las ve
 * distintas y ofrece "actualizar la imagen" en productos donde la foto no
 * cambió. Eso no sería grave si no fuera porque aplicar la foto **despega la
 * línea del catálogo** (el PUT por-ítem trata la imagen como un campo editado),
 * y entonces esa línea deja de recibir los precios del catálogo para siempre.
 *
 * Le pasó a MJ con el MEZCLADOR URBAN CROMO de Casa Los Algarrobos: la línea
 * quedó despegada sin que ella tocara ningún precio, solo por aceptar una foto
 * que era exactamente la misma. En el catálogo hay 23 productos todavía con el
 * dominio viejo, así que sin esto el problema se repetiría en cada revisión.
 *
 * Criterio conservador: se consideran la misma imagen solo si la RUTA del
 * archivo es idéntica y ambos dominios son CDNs de VTEX **de la misma tienda**.
 * Dos rutas iguales en tiendas distintas NO se dan por iguales.
 */

function esCdnVtex(host: string): boolean {
  return host.endsWith("vteximg.com.br") || host.endsWith("vtexassets.com");
}

// "mkchile.vtexassets.com" → "mkchile"
function tienda(host: string): string {
  return host.split(".")[0];
}

export function esLaMismaImagen(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  let ua: URL, ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    // Alguna no es una URL absoluta (ej. una foto subida como data:): sin
    // forma de compararlas más que por texto, y eso ya se descartó arriba.
    return false;
  }
  if (ua.pathname !== ub.pathname) return false;
  return (
    esCdnVtex(ua.hostname) &&
    esCdnVtex(ub.hostname) &&
    tienda(ua.hostname) === tienda(ub.hostname)
  );
}
