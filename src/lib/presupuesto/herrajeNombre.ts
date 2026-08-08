/**
 * Cómo se ESCRIBE el nombre de un herraje (pendiente 139).
 *
 * El catálogo se cargó por tandas y cada proveedor entró con su propia
 * convención: HBT vino todo en MAYÚSCULA (lo carga un script), DPH mezcla
 * estilo oración, Title Case y MAYÚSCULA. En la misma partida de una cotización
 * conviven los tres y se ve desprolijo.
 *
 * MJ eligió (2026-08-08, mirando los nombres reales de los dos estilos) que
 * vaya CADA PALABRA CON MAYÚSCULA, salvo las excepciones de abajo:
 *
 *   "CORREDERA OCULTA EXTENSIÓN TOTAL"  →  "Corredera Oculta Extensión Total"
 *   "DESPENSA SPACETOWER MERIVOBOX 500MM" → "Despensa Spacetower Merivobox 500mm"
 *
 * Se normaliza el DISPLAY, NO el dato. Si reescribiéramos el catálogo, la
 * próxima tanda de HBT (que se carga por script en MAYÚSCULA) desharía la
 * homologación en silencio. Por eso este helper es UNO SOLO y lo usan tanto el
 * editor como los dos PDF: no pueden divergir.
 *
 * Las cuatro excepciones, todas pedidas por MJ mirando los casos raros:
 *   - Medidas y unidades en minúscula: "500MM" → "500mm", "40KG" → "40kg",
 *     "(X10)" → "(x10)". Bajarlas es la escritura correcta.
 *   - Siglas tal cual: "3D" sigue siendo "3D", no "3d".
 *   - Litros pegado al número con mayúscula: "2X33L" → "2x33L".
 *   - Conectores en minúscula, como en cualquier título en castellano:
 *     "sin Retén", "para Despensa", "con Guardacuerpo".
 */

// Marcas y líneas de producto: siempre con mayúscula inicial, en cualquier
// posición. Sin esta lista, "merivobox" quedaría en minúscula cuando cae detrás
// de un conector.
const NOMBRES_PROPIOS = new Set([
  "blum",
  "merivobox",
  "blumotion",
  "cliptop",
  "spacetower",
  "movento",
  "libell",
  "dph",
  "hbt",
]);

// Siglas que se conservan enteras en mayúscula: en minúscula dejan de leerse
// como sigla ("bisagra 3d", "cierre led"). Las UNIDADES no van acá — "500mm" y
// "40kg" son la escritura correcta, así que bajarlas las mejora.
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
]);

// Conectores que quedan en minúscula, salvo que abran el nombre. "c" entra por
// "c/acople", que es "con acople".
const CONECTORES = new Set([
  "de",
  "del",
  "con",
  "para",
  "a",
  "al",
  "en",
  "y",
  "o",
  "la",
  "el",
  "los",
  "las",
  "sin",
  "por",
  "un",
  "una",
  "c",
]);

// Letras sueltas que son código de modelo de Blum ("Merivobox E", "Merivobox
// M"), no palabras del castellano. Ojo: "a" y "c" NO van acá — son preposición
// y abreviatura de "con".
const LETRAS_MODELO = new Set(["e", "m"]);

const capitalizar = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Devuelve el nombre del herraje con cada palabra en mayúscula, respetando
 * marcas, siglas, unidades y conectores. Idempotente: aplicarlo dos veces da
 * lo mismo.
 */
export function formatHerrajeName(raw: string | null | undefined): string {
  if (!raw) return "";
  const limpio = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (!limpio) return "";

  // `primera` marca si todavía no salió ninguna palabra: la que abre el nombre
  // va con mayúscula aunque sea un conector.
  let primera = true;
  const out = limpio.replace(/[\p{L}\p{N}]+/gu, (token) => {
    const arriba = token.toUpperCase();

    if (SIGLAS.has(arriba)) {
      primera = false;
      return arriba;
    }
    if (NOMBRES_PROPIOS.has(token)) {
      primera = false;
      return capitalizar(token);
    }
    if (token.length === 1 && LETRAS_MODELO.has(token)) {
      primera = false;
      return arriba;
    }
    // Litros pegado al número: "2x33l" → "2x33L".
    if (/^\d.*l$/.test(token)) {
      primera = false;
      return token.slice(0, -1) + "L";
    }
    // Medidas y códigos que arrancan con número ("500mm", "40kg", "110") y el
    // multiplicador ("x10"): quedan en minúscula.
    if (/^\d/.test(token) || /^x\d+$/.test(token)) {
      primera = false;
      return token;
    }
    if (!primera && CONECTORES.has(token)) return token;
    primera = false;
    return capitalizar(token);
  });

  // Red de seguridad: si el nombre abre con un número o un signo, la primera
  // letra real igual va en mayúscula.
  return out.replace(
    /^(\P{L}*)(\p{L})/u,
    (_m, previo: string, letra: string) => previo + letra.toUpperCase(),
  );
}
