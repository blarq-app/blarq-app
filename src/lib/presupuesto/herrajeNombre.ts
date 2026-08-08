/**
 * Cómo se ESCRIBE el nombre de un herraje (pendiente 139).
 *
 * El catálogo se cargó por tandas y cada proveedor entró con su propia
 * convención: HBT vino todo en MAYÚSCULA (lo carga un script), DPH mezcla
 * estilo oración, Title Case y MAYÚSCULA. En la misma partida de una cotización
 * conviven los tres y se ve desprolijo.
 *
 * MJ eligió ESTILO ORACIÓN: primera letra en mayúscula, el resto en minúscula.
 *   "CAJÓN MERIVOBOX E 500MM"  →  "Cajón merivobox e 500mm"
 *
 * Se normaliza el DISPLAY, NO el dato. Si reescribiéramos el catálogo, la
 * próxima tanda de HBT (que se carga por script en MAYÚSCULA) desharía la
 * homologación en silencio. Por eso este helper es UNO SOLO y lo usan tanto el
 * editor como los dos PDF: no pueden divergir.
 */

// Siglas que se pierden al bajar todo a minúscula y que sí queremos conservar
// tal cual, porque en minúscula dejan de leerse como sigla ("bisagra 3d",
// "cierre led"). Las unidades NO van acá: "500MM" → "500mm" y "40KG" → "40kg"
// son la escritura correcta, así que el pasaje a minúscula las mejora.
const SIGLAS = new Set([
  "2D",
  "3D",
  "4D",
  "LED",
  "XL",
  "XXL",
  "PVC",
  "MDF",
  "ABS",
  "USB",
  "UV",
  "LR",
]);

/**
 * Devuelve el nombre del herraje en estilo oración, conservando las siglas
 * conocidas. Idempotente: aplicarlo dos veces da lo mismo.
 */
export function formatHerrajeName(raw: string | null | undefined): string {
  if (!raw) return "";
  const limpio = raw.replace(/\s+/g, " ").trim();
  if (!limpio) return "";

  // Todo a minúscula y después se restituyen las siglas conocidas. El token es
  // una corrida de letras/dígitos (incluye acentos y ñ); los separadores
  // (espacios, guiones, paréntesis, °) quedan intactos.
  const bajo = limpio.toLowerCase();
  const conSiglas = bajo.replace(/[\p{L}\p{N}]+/gu, (token) => {
    const arriba = token.toUpperCase();
    return SIGLAS.has(arriba) ? arriba : token;
  });

  // Primera letra en mayúscula. Si el nombre arranca con un número o un signo
  // ("2 cajones…"), se salta hasta la primera letra real.
  return conSiglas.replace(
    /^(\P{L}*)(\p{L})/u,
    (_m, previo: string, letra: string) => previo + letra.toUpperCase(),
  );
}
