/**
 * Partidas de muebles: cuáles suman y cuáles son alternativas para el cliente.
 *
 * Desde la pendiente 177 (2026-09-10) una partida de muebles puede ser una
 * ALTERNATIVA de otra (`MuebleItem.alternativeOfId`): el mismo mueble en otro
 * material o con otras características, con su propio precio, que el cliente
 * ve al lado de la partida base con la diferencia. Caso real: la cocina de
 * Candelaria se cotizó en tres melaminas (Vesto / Gizir / Egger) y eran tres
 * versiones enteras donde cambiaba UNA partida.
 *
 * REGLA DURA: la alternativa NO suma en ningún total. El total del
 * presupuesto, el subtotal del capítulo, las formas de pago, el acordado del
 * proyecto y el fondo de sueldos se calculan SOLO con las partidas base.
 *
 * Este archivo es la ÚNICA definición de ese criterio. Los seis lugares que
 * suman muebles (metrics.ts, cuadroResumen.ts, fondoSueldos.ts, el PDF, la
 * lista de versiones y el editor) pasan por `soloPrincipales` en vez de hacer
 * su propio filtro — ya pasó con la versión vigente que cuatro copias del
 * mismo criterio divergieron (ver selectVersion.ts).
 */

// Lo mínimo que hay que saber de una partida para decidir si suma. Se acepta
// `undefined` además de `null` para que los objetos viejos (fotos de enviado
// anteriores a la columna, selects que no la piden) sigan contando como base.
export type MuebleItemAlternable = {
  alternativeOfId?: string | null;
};

// Partidas BASE: las que suman y las que el cliente ve numeradas.
export function soloPrincipales<T extends MuebleItemAlternable>(items: T[]): T[] {
  return items.filter((it) => !esAlternativa(it));
}

export function esAlternativa(item: MuebleItemAlternable): boolean {
  return item.alternativeOfId != null;
}

// Alternativas de UNA partida base, en el orden en que vienen.
export function alternativasDe<T extends MuebleItemAlternable & { id?: string }>(
  items: T[],
  baseId: string,
): T[] {
  return items.filter((it) => it.alternativeOfId === baseId);
}

// Partidas base con sus alternativas colgadas, en el orden de las base. Es lo
// que dibujan el editor y el PDF: la lista numerada son las base, y bajo cada
// una sus alternativas con sangría. Una alternativa cuya base no está en la
// lista (no debería pasar: la API cascadea) se descarta en vez de colarse
// como base.
export function agruparConAlternativas<
  T extends MuebleItemAlternable & { id: string },
>(items: T[]): { base: T; alternativas: T[] }[] {
  return soloPrincipales(items).map((base) => ({
    base,
    alternativas: alternativasDe(items, base.id),
  }));
}

// Diferencia de precio al cliente (c/IVA, por la cantidad) entre una
// alternativa y su base. Positiva = la alternativa es más cara.
export function diferenciaConBase(
  alternativa: { clientPriceIva: number; quantity: number },
  base: { clientPriceIva: number; quantity: number },
): number {
  return (
    alternativa.clientPriceIva * alternativa.quantity -
    base.clientPriceIva * base.quantity
  );
}

// "+$767.609" / "−$658.575" / "" cuando no hay diferencia (el cero no ocupa
// espacio). El signo menos es el tipográfico (U+2212), que alinea con el "+".
export function formatDiferencia(
  diff: number,
  fmt: (n: number) => string,
): string {
  const r = Math.round(diff);
  if (r === 0) return "";
  return (r > 0 ? "+" : "−") + fmt(Math.abs(r));
}
