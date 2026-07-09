// Selección de la(s) versión(es) VIGENTE(s) de un presupuesto por tipo.
//
// FUENTE ÚNICA de este criterio. Antes estaba copiado en 4 lugares
// (metrics.ts, resumen/page.tsx, fondoSueldos.ts, cuadroResumen.ts) y ya
// habían divergido: el Resumen sumaba anexos y el Fondo de Sueldos no, así que
// mostraban totales distintos para el mismo proyecto. Ahora los 4 importan de
// acá para que no puedan volver a contradecirse.
//
// Regla (confirmada con MJ 2026-07-09) — "última ENVIADA gana", con anexos:
//   1. Si hay 2+ versiones APROBADAS del mismo tipo → son ANEXOS (obra
//      principal + "baño visitas", ambos aprobados): se DEVUELVEN TODAS para
//      que el llamador las sume. Es la única señal confiable de anexo: el
//      vínculo de linaje (parentVersionId) está roto en prod para muchas
//      versiones sucesivas, así que agrupar por linaje duplicaría (ej.
//      artefactos V5→V6 de JNC/Sena aparecen como linajes distintos).
//   2. Si no → la MÁS RECIENTE (por createdAt) con status en {enviado,
//      aprobado}. Así una versión enviada nueva le gana a una aprobada más
//      vieja, y los borradores/rechazados quedan afuera.
//   3. Si NO hay ninguna enviada/aprobada → fallback a la más reciente (incl.
//      borrador). Un borrador nunca le gana a algo enviado; solo aparece si es
//      lo único que hay (proyecto recién empezado), para no dejar el Resumen
//      en blanco.
//
// `selectVigentes` devuelve el arreglo (para sumar obra/anexos). `selectVigente`
// devuelve la principal (la más reciente de las vigentes) para los usos que
// esperan UNA sola versión (muebles, artefactos, labels).

type VersionLike = { status: string; createdAt: Date };

const porFechaDesc = <T extends VersionLike>(a: T, b: T) =>
  b.createdAt.getTime() - a.createdAt.getTime();

export function selectVigentes<T extends VersionLike>(arr: T[]): T[] {
  const aprobadas = arr.filter((b) => b.status === "aprobado");
  if (aprobadas.length >= 2) return aprobadas; // anexo → sumar todas

  const vigentes = arr
    .filter((b) => b.status === "enviado" || b.status === "aprobado")
    .sort(porFechaDesc);
  if (vigentes[0]) return [vigentes[0]];

  // Solo borradores/rechazados: mostrar el más reciente para no quedar en blanco.
  const fallback = [...arr].sort(porFechaDesc)[0];
  return fallback ? [fallback] : [];
}

export function selectVigente<T extends VersionLike>(arr: T[]): T | undefined {
  // La principal = la más reciente de las vigentes (en el caso anexo, la
  // aprobada más nueva; para labels/lookups de una sola versión).
  return [...selectVigentes(arr)].sort(porFechaDesc)[0];
}
