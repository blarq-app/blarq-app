/**
 * Links a las fotos guardadas en la app (cajón de fotos, 2026-09-27).
 *
 * Este archivo no importa nada del servidor: lo usan tanto las pantallas como
 * las rutas. La copia en sí (bajar, achicar, guardar) vive en `guardarFoto.ts`.
 *
 * Una foto guardada se anota en `imageUrl` como un link corto a nuestra propia
 * app: `/api/fotos/<id>`. Todo lo que ya mostraba `imageUrl` lo sigue mostrando
 * sin cambios (un <img> acepta ese link igual que el de una tienda); lo que
 * cambia es que la foto ya no depende de que la tienda la mantenga publicada.
 */

export const PREFIJO_FOTO_GUARDADA = "/api/fotos/";

/** ¿Este `imageUrl` es una copia guardada en la app? */
export function esFotoGuardada(url: string | null | undefined): boolean {
  return !!url && url.startsWith(PREFIJO_FOTO_GUARDADA);
}

/** Id de la copia guardada, o null si el link no es de una copia. */
export function idDeFotoGuardada(url: string | null | undefined): string | null {
  if (!esFotoGuardada(url)) return null;
  const id = url!.slice(PREFIJO_FOTO_GUARDADA.length).split(/[/?#]/)[0];
  return /^[a-z0-9]{10,40}$/i.test(id) ? id : null;
}

export function linkDeFotoGuardada(id: string): string {
  return `${PREFIJO_FOTO_GUARDADA}${id}`;
}

/**
 * Lo que se muestra en los campos "URL de imagen" de los formularios.
 *
 * Las fotos que viven en la app (copias guardadas y fotos subidas a mano) no
 * tienen un link que tenga sentido leer o editar: el campo se muestra vacío y
 * sirve solo para pegar un link NUEVO. Mostrar "/api/fotos/ckx…" confundiría,
 * y borrarlo a mano no es la forma de sacar la foto (para eso está "Borrar").
 */
export function linkEditableDeFoto(url: string | null | undefined): string {
  if (!url || url.startsWith("data:") || esFotoGuardada(url)) return "";
  return url;
}
