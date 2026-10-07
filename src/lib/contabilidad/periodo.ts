// Período de los documentos para el contador (Cartola y Rendiciones): un mes
// o el año completo, en la URL como ?periodo=2026-07 o ?periodo=2026.
//
// Vive en un solo lugar porque lo leen las dos pantallas y sus dos endpoints:
// si cada uno lo parseara a su manera, la pantalla podría mostrar un mes y el
// archivo bajar otro.

export const MESES_PERIODO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export type Periodo = { year: number; month: number | null }; // month null = año completo

/** "2026-07" → julio 2026 · "2026" → año 2026 · otra cosa → null. */
export function leerPeriodo(raw: string | null | undefined): Periodo | null {
  const m = raw?.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (!m[2]) return { year, month: null };
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Sin período en la URL: el mes ANTERIOR, que es el que se le manda al
 *  contador (lo de julio se manda en agosto). */
export function periodoPorDefecto(hoy = new Date()): Periodo {
  const anterior = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1));
  return { year: anterior.getUTCFullYear(), month: anterior.getUTCMonth() + 1 };
}

export function periodoParam(p: Periodo): string {
  return p.month == null ? String(p.year) : `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** "julio 2026" / "año 2026". */
export function nombrePeriodo(p: Periodo): string {
  return p.month == null ? `año ${p.year}` : `${MESES_PERIODO[p.month - 1]} ${p.year}`;
}
