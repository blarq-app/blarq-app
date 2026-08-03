/**
 * Traduce el nombre de un CAPÍTULO del presupuesto de obra a la CATEGORÍA
 * equivalente del Catálogo de Partidas.
 *
 * Por qué hace falta: son dos vocabularios distintos que nunca se homologaron.
 * Los capítulos del presupuesto son texto libre desde el PR #331 (MJ los
 * escribe como quiere, y su nombre sale en el PDF del cliente); las categorías
 * del catálogo son una lista de 12 con orden cronológico de obra
 * (CATALOG_CATEGORY_ORDER en lib/utils.ts). Se parecen pero no son iguales:
 *
 *   capítulo                                  →  categoría del catálogo
 *   INSTALACIONES ELECTRICAS                  →  INSTALACIONES ELECT.
 *   INSTALACIONES SANITARIAS Y GASFITERIA     →  INSTALACIONES SANITARIAS
 *   LIMPIEZA Y ASEO                           →  ASEO Y LIMPIEZA
 *
 * Sin esta traducción, guardar una partida al catálogo crearía categorías
 * NUEVAS casi idénticas a las que ya existen ("INSTALACIONES ELECTRICAS" al
 * lado de "INSTALACIONES ELECT."), que además caen sueltas al final del
 * catálogo porque compareCatalogCategories manda las desconocidas al fondo.
 *
 * Cuando el capítulo no se parece a ninguna de las 12 (caso real: ADICIONALES),
 * se devuelve su propio nombre en mayúsculas: es una categoría genuinamente
 * nueva, no un duplicado, y se crea así. NO se adivina un calce parecido: es
 * peor mandar una partida a la categoría equivocada que crear una nueva.
 *
 * Esto NO renombra datos: los capítulos del presupuesto siguen llamándose como
 * MJ los escribió (el PDF del cliente no cambia). Es solo el puente al guardar.
 */

import { CATALOG_CATEGORY_ORDER } from "@/lib/utils";

// Mayúsculas, sin acentos, sin puntos finales, espacios colapsados. Así
// "Instalaciones Eléctricas" y "INSTALACIONES ELECTRICAS " son lo mismo.
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Sinónimos conocidos: nombre de capítulo (normalizado) → categoría exacta del
// catálogo. Solo los que MJ ya usa o son evidentes; no se inventan calces.
const SINONIMOS: Record<string, string> = {
  "INSTALACIONES ELECTRICAS": "INSTALACIONES ELECT.",
  "INSTALACIONES ELECTRICA": "INSTALACIONES ELECT.",
  "INSTALACION ELECTRICA": "INSTALACIONES ELECT.",
  ELECTRICAS: "INSTALACIONES ELECT.",
  ELECTRICIDAD: "INSTALACIONES ELECT.",

  "INSTALACIONES SANITARIAS Y GASFITERIA": "INSTALACIONES SANITARIAS",
  "INSTALACIONES SANITARIAS Y GAS": "INSTALACIONES SANITARIAS",
  "INSTALACION SANITARIA": "INSTALACIONES SANITARIAS",
  SANITARIAS: "INSTALACIONES SANITARIAS",
  GASFITERIA: "INSTALACIONES SANITARIAS",

  "INSTALACIONES DE GAS": "INSTALACIONES GAS",
  "INSTALACION DE GAS": "INSTALACIONES GAS",
  GAS: "INSTALACIONES GAS",

  "LIMPIEZA Y ASEO": "ASEO Y LIMPIEZA",
  ASEO: "ASEO Y LIMPIEZA",
  LIMPIEZA: "ASEO Y LIMPIEZA",

  PRELIMINARES: "OBRAS PRELIMINARES",
  "OBRA PRELIMINAR": "OBRAS PRELIMINARES",

  AISLACION: "AISLACION E IMPERMEABILIZACION",
  IMPERMEABILIZACION: "AISLACION E IMPERMEABILIZACION",
  "AISLACION Y IMPERMEABILIZACION": "AISLACION E IMPERMEABILIZACION",

  DEMOLICION: "DEMOLICIONES",
  REPARACION: "REPARACIONES",
  TERMINACION: "TERMINACIONES",
  MUEBLE: "MUEBLES",
};

/**
 * @param nombreCapitulo  nombre del capítulo tal como está en el presupuesto.
 * @returns categoría del catálogo donde debe ir la partida, y si esa categoría
 *          es una de las 12 conocidas o una nueva (para poder avisarlo).
 */
export function homologarCategoria(nombreCapitulo: string): {
  categoria: string;
  esNueva: boolean;
} {
  const norm = normalizar(nombreCapitulo || "");
  if (!norm) return { categoria: "", esNueva: false };

  // 1) ¿Calza exacto (normalizado) con una de las 12 del catálogo?
  const conocidas = CATALOG_CATEGORY_ORDER as readonly string[];
  const exacta = conocidas.find((c) => normalizar(c) === norm);
  if (exacta) return { categoria: exacta, esNueva: false };

  // 2) ¿Es un sinónimo conocido?
  const sinonimo = SINONIMOS[norm];
  if (sinonimo) return { categoria: sinonimo, esNueva: false };

  // 3) Categoría genuinamente nueva. Se usa el nombre del capítulo tal cual
  //    (en mayúsculas, que es la convención del catálogo).
  return { categoria: norm, esNueva: true };
}
