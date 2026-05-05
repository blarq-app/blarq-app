// Validación y normalización de RUT chileno.
//
// El RUT chileno tiene un cuerpo numérico (1-8 dígitos) y un dígito
// verificador (DV) que es 0-9 o K, calculado por módulo 11 sobre el
// cuerpo. Validar el DV evita que MJ tipee un RUT mal y se entere recién
// cuando el SII rechaza la emisión de un DTE.
//
// Convenciones de la app:
// - **Almacenamiento (BD)**: forma compacta sin puntos, con guión y DV
//   en mayúscula. Ej: "12345678-9", "76123456-K". Garantiza unicidad
//   exacta de string si más adelante usamos el RUT como key/lookup.
// - **Display (UI)**: forma con puntos. Ej: "12.345.678-9", "76.123.456-K".
//   Solo para mostrar — no se guarda así.
// - **Input**: aceptamos cualquier forma (con o sin puntos, con o sin
//   guión, k minúscula). El parser normaliza.

/** Quita puntos, espacios y unifica K mayúscula. NO valida. */
function strip(input: string): string {
  return input.replace(/[.\s]/g, "").replace(/k$/i, "K");
}

/**
 * Calcula el dígito verificador de un cuerpo numérico (módulo 11).
 * Devuelve "0"-"9" o "K".
 */
export function computeDV(bodyNum: number): string {
  let sum = 0;
  let factor = 2;
  let n = Math.abs(Math.trunc(bodyNum));
  while (n > 0) {
    sum += (n % 10) * factor;
    n = Math.floor(n / 10);
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (sum % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * Resultado de un parse: si es válido, trae las piezas listas para
 * guardar. Si no, trae mensaje en castellano para mostrar al usuario.
 */
export type RutParseResult =
  | { ok: true; body: number; dv: string; canonical: string }
  | { ok: false; reason: string };

/**
 * Parsea cualquier formato razonable de RUT y devuelve la forma canónica
 * (sin puntos, con guión, DV mayúscula) si pasa validación de DV.
 */
export function parseRut(input: string): RutParseResult {
  if (!input || typeof input !== "string") {
    return { ok: false, reason: "Falta el RUT" };
  }
  const clean = strip(input.trim());
  if (clean === "") return { ok: false, reason: "Falta el RUT" };

  // Acepta con o sin guión. Si no tiene guión, asume que el último
  // caracter es el DV.
  let bodyStr: string;
  let dvStr: string;
  if (clean.includes("-")) {
    const parts = clean.split("-");
    if (parts.length !== 2) return { ok: false, reason: "Formato inválido" };
    [bodyStr, dvStr] = parts;
  } else {
    if (clean.length < 2) return { ok: false, reason: "RUT muy corto" };
    bodyStr = clean.slice(0, -1);
    dvStr = clean.slice(-1);
  }

  if (!/^\d{1,8}$/.test(bodyStr)) {
    return { ok: false, reason: "El cuerpo del RUT debe tener entre 1 y 8 dígitos" };
  }
  if (!/^[\dK]$/.test(dvStr)) {
    return { ok: false, reason: "El dígito verificador debe ser 0-9 o K" };
  }

  const body = parseInt(bodyStr, 10);
  if (body < 1) return { ok: false, reason: "RUT inválido" };

  const expectedDV = computeDV(body);
  if (expectedDV !== dvStr) {
    return {
      ok: false,
      reason: `Dígito verificador no coincide (esperado: ${expectedDV})`,
    };
  }

  return {
    ok: true,
    body,
    dv: dvStr,
    canonical: `${body}-${dvStr}`,
  };
}

/** Atajo: ¿es válido? (sin detalles del motivo). */
export function isValidRut(input: string): boolean {
  return parseRut(input).ok;
}

/** Convierte a forma canónica para guardar. Lanza si es inválido. */
export function normalizeRut(input: string): string {
  const r = parseRut(input);
  if (!r.ok) throw new Error(r.reason);
  return r.canonical;
}

/**
 * Formatea para display con puntos: "12.345.678-9".
 * Si el input es inválido lo devuelve tal cual (no rompe la UI).
 */
export function formatRutForDisplay(input: string | null | undefined): string {
  if (!input) return "";
  const r = parseRut(input);
  if (!r.ok) return input;
  const bodyStr = String(r.body);
  // Inserta puntos cada 3 dígitos desde la derecha
  const withDots = bodyStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${r.dv}`;
}
