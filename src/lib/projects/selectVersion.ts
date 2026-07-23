// Selección de la(s) versión(es) VIGENTE(s) de un presupuesto por tipo.
//
// FUENTE ÚNICA de este criterio. Antes estaba copiado en 4 lugares
// (metrics.ts, resumen/page.tsx, fondoSueldos.ts, cuadroResumen.ts) y ya
// habían divergido: el Resumen sumaba anexos y el Fondo de Sueldos no, así que
// mostraban totales distintos para el mismo proyecto. Ahora los 4 importan de
// acá para que no puedan volver a contradecirse.
//
// Regla (confirmada con MJ 2026-07-22) — "manda UNA SOLA versión: la última":
//   1. La MÁS RECIENTE (por createdAt) con status en {enviado, aprobado}. Así
//      una versión enviada nueva le gana a una aprobada más vieja, y los
//      borradores/rechazados quedan afuera.
//   2. Si NO hay ninguna enviada/aprobada → fallback a la más reciente (incl.
//      borrador). Un borrador nunca le gana a algo enviado; solo aparece si es
//      lo único que hay (proyecto recién empezado), para no dejar el Resumen
//      en blanco.
//
// NO hay caso "anexo". Hasta 2026-07-22 existía un paso previo: si había 2+
// versiones APROBADAS del mismo tipo se devolvían TODAS para que el llamador
// las sumara (obra principal + "baño visitas" de Aguirre). MJ lo sacó: confundía
// más de lo que ayudaba — el Resumen mostraba la suma de dos versiones sin decir
// cuáles, y aprobar una segunda versión inflaba el Total Acordado sin aviso.
// Un anexo ahora se representa metiendo sus partidas DENTRO de una versión nueva
// (Aguirre V8 = V7 + las 16 partidas del baño de visitas), que es lo que el
// cliente firma igual: un solo documento con el total.
//
// `selectVigentes` sigue devolviendo un arreglo (siempre de 0 ó 1 elemento) para
// no cambiar la firma de los 4 consumidores. `selectVigente` devuelve esa misma
// versión para los usos que esperan una sola (muebles, artefactos, labels).

type VersionLike = { status: string; createdAt: Date };

const porFechaDesc = <T extends VersionLike>(a: T, b: T) =>
  b.createdAt.getTime() - a.createdAt.getTime();

export function selectVigentes<T extends VersionLike>(arr: T[]): T[] {
  const vigentes = arr
    .filter((b) => b.status === "enviado" || b.status === "aprobado")
    .sort(porFechaDesc);
  if (vigentes[0]) return [vigentes[0]];

  // Solo borradores/rechazados: mostrar el más reciente para no quedar en blanco.
  const fallback = [...arr].sort(porFechaDesc)[0];
  return fallback ? [fallback] : [];
}

export function selectVigente<T extends VersionLike>(arr: T[]): T | undefined {
  return selectVigentes(arr)[0];
}
