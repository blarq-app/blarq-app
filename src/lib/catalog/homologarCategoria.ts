/**
 * Resuelve un nombre de capítulo (o de categoría) al nombre CANÓNICO de LA
 * LISTA única — `CAPITULOS` en lib/presupuesto/chapters.ts.
 *
 * Desde 2026-08-03 los capítulos del presupuesto y las categorías del catálogo
 * son un solo vocabulario, y los nombres del presupuesto son los que mandan
 * (salen en el PDF del cliente; los del catálogo los ve solo BLARQ). Este
 * módulo dejó de ser un puente entre dos listas y pasó a ser la RED: traduce
 * los nombres viejos que quedaron escritos en datos históricos, y aguanta que
 * MJ escriba un capítulo a mano con tildes, minúsculas o un sinónimo.
 *
 *   nombre viejo / escrito a mano   →  canónico
 *   INSTALACIONES ELECT.            →  INSTALACIONES ELECTRICAS
 *   INSTALACIONES SANITARIAS        →  INSTALACIONES SANITARIAS Y GASFITERIA
 *   INSTALACIONES GAS               →  INSTALACIONES SANITARIAS Y GASFITERIA
 *   ASEO Y LIMPIEZA                 →  LIMPIEZA Y ASEO
 *
 * Sirve para dos cosas:
 *   1. Guardar una partida al catálogo: decide en qué categoría cae, sin crear
 *      categorías nuevas casi idénticas a las que ya existen.
 *   2. Ordenar el catálogo (`compareCatalogCategories`): mientras convivan un
 *      nombre viejo y su reemplazo —entre el deploy y la migración de datos—
 *      los dos caen en la MISMA posición y no aparece una categoría suelta al
 *      final de la pantalla.
 *
 * Un capítulo sin equivalente (caso real: ADICIONALES, que a propósito no es
 * categoría del catálogo) devuelve su propio nombre en mayúsculas, marcado como
 * nuevo. NO se adivina un calce parecido: es peor mandar una partida a la
 * categoría equivocada que crear una categoría nueva.
 *
 * Esto NO renombra datos. Es solo lectura.
 */

import { CAPITULOS } from "@/lib/presupuesto/chapters";

// Mayúsculas, sin acentos, sin puntos, espacios colapsados. Así
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

// Sinónimos → nombre canónico. Los cuatro primeros son los nombres VIEJOS de
// las categorías del catálogo: quedan acá para que los datos históricos —y
// cualquier base que todavía no se haya migrado— sigan cayendo bien.
const SINONIMOS: Record<string, string> = {
  "INSTALACIONES ELECT": "INSTALACIONES ELECTRICAS",
  "INSTALACIONES SANITARIAS": "INSTALACIONES SANITARIAS Y GASFITERIA",
  "INSTALACIONES GAS": "INSTALACIONES SANITARIAS Y GASFITERIA",
  "ASEO Y LIMPIEZA": "LIMPIEZA Y ASEO",

  "INSTALACIONES ELECTRICA": "INSTALACIONES ELECTRICAS",
  "INSTALACION ELECTRICA": "INSTALACIONES ELECTRICAS",
  ELECTRICAS: "INSTALACIONES ELECTRICAS",
  ELECTRICIDAD: "INSTALACIONES ELECTRICAS",

  "INSTALACIONES SANITARIAS Y GAS": "INSTALACIONES SANITARIAS Y GASFITERIA",
  "INSTALACION SANITARIA": "INSTALACIONES SANITARIAS Y GASFITERIA",
  SANITARIAS: "INSTALACIONES SANITARIAS Y GASFITERIA",
  GASFITERIA: "INSTALACIONES SANITARIAS Y GASFITERIA",
  "INSTALACIONES DE GAS": "INSTALACIONES SANITARIAS Y GASFITERIA",
  GAS: "INSTALACIONES SANITARIAS Y GASFITERIA",

  ASEO: "LIMPIEZA Y ASEO",
  LIMPIEZA: "LIMPIEZA Y ASEO",

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
 * @param nombre  capítulo del presupuesto, o categoría del catálogo.
 * @returns el nombre canónico de LA LISTA, y si es uno que la lista no conoce.
 */
export function homologarCategoria(nombre: string): {
  categoria: string;
  esNueva: boolean;
} {
  const norm = normalizar(nombre || "");
  if (!norm) return { categoria: "", esNueva: false };

  // 1) ¿Calza exacto (normalizado) con una de LA LISTA?
  const conocidas = CAPITULOS as readonly string[];
  const exacta = conocidas.find((c) => normalizar(c) === norm);
  if (exacta) return { categoria: exacta, esNueva: false };

  // 2) ¿Es un nombre viejo o un sinónimo conocido?
  const sinonimo = SINONIMOS[norm];
  if (sinonimo) return { categoria: sinonimo, esNueva: false };

  // 3) Nombre genuinamente nuevo (ADICIONALES, o lo que MJ escriba).
  return { categoria: norm, esNueva: true };
}
