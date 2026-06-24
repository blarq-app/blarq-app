/**
 * Zona (subChapter) DERIVADA por posición — fuente única para el editor de
 * cotización y el PDF de obra.
 *
 * La zona de una partida NO se lee cruda del campo guardado: una partida sin
 * zona propia HEREDA la zona de la partida de arriba (la última zona-encabezado
 * por orden de posición / sortOrder). Así el editor y el PDF calculan la zona
 * con la MISMA regla y es imposible que muestren cosas distintas — antes el PDF
 * agrupaba alfabéticamente por subChapter y mandaba las partidas sin zona
 * (recién creadas) huérfanas arriba del capítulo, descuadradas respecto a la
 * pantalla.
 *
 * Decisión MJ 2026-06-24 ("la posición manda", pendiente 54). No toca la base
 * de datos: el campo subChapter se sigue guardando igual; solo cambia cómo se
 * INTERPRETA al mostrar (una partida con subChapter abre/continúa su zona; una
 * sin subChapter cae en la zona de arriba).
 *
 * Función pura. Recibe las partidas YA ordenadas por sortOrder DENTRO de un
 * capítulo (la herencia se calcula sobre ese orden).
 */
export interface ZoneRow<T> {
  item: T;
  /** Zona efectiva: la propia si la tiene, sino la heredada de arriba. null = todavía sin zona. */
  zone: string | null;
  /** true en la primera partida de cada zona — ahí va el encabezado / bandita gris. */
  isZoneStart: boolean;
}

export interface ZoneAnnotation<T> {
  rows: ZoneRow<T>[];
  /** Subtotal por zona efectiva. La key "" agrupa las partidas sin zona (arriba del capítulo). */
  zoneSubtotals: Map<string, number>;
  /** Mostrar subtotales de zona solo si hay 2+ zonas distintas (sino == subtotal del capítulo y solo agrega ruido). */
  showZoneSubtotals: boolean;
}

export function annotateZones<
  T extends { subChapter?: string | null; total: number }
>(itemsSortedByOrder: T[]): ZoneAnnotation<T> {
  let current: string | null = null;
  let prevZone: string | null = null;
  const rows: ZoneRow<T>[] = itemsSortedByOrder.map((item) => {
    const own =
      item.subChapter && item.subChapter.trim() ? item.subChapter.trim() : null;
    // Una partida con zona propia abre (o continúa) esa zona; las de abajo sin
    // zona la heredan hasta que aparezca otra zona propia.
    if (own) current = own;
    const zone = current;
    const isZoneStart = zone !== null && zone !== prevZone;
    prevZone = zone;
    return { item, zone, isZoneStart };
  });

  const zoneSubtotals = new Map<string, number>();
  for (const r of rows) {
    const k = r.zone ?? "";
    zoneSubtotals.set(k, (zoneSubtotals.get(k) ?? 0) + r.item.total);
  }
  const showZoneSubtotals = new Set(rows.map((r) => r.zone ?? "")).size > 1;

  return { rows, zoneSubtotals, showZoneSubtotals };
}
