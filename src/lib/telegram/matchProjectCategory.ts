// Matchea el texto libre que escribe MJ/JT ("Portofino materiales") contra
// los proyectos y categorías reales de la app.
//
// Filosofía conservadora (igual que la conciliación bancaria): si no hay un
// match claro y único, NO adivinamos — devolvemos las opciones para que el
// bot pida que lo escriban de nuevo. Asignar a la obra equivocada es peor
// que pedir que repitan.

import { prisma } from "@/lib/prisma";

/** Normaliza para comparar: minúsculas, sin tildes, sin puntuación. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca tildes (rango de diacríticos Unicode)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NamedMatch {
  id: string;
  name: string;
}

export interface MatchResult<T> {
  // "exacto"    → un solo candidato claro: se usa directo.
  // "ambiguo"   → varios candidatos plausibles: el bot lista opciones.
  // "ninguno"   → nada calzó: el bot lista todo lo disponible.
  kind: "exacto" | "ambiguo" | "ninguno";
  match?: T;
  candidates: T[];
}

/**
 * Busca el mejor candidato cuyo nombre aparezca en el texto.
 * Estrategia: contamos cuántas PALABRAS del texto coinciden con palabras del
 * nombre del candidato (intersección). Gana el de más coincidencias, siempre
 * que sea ÚNICO (le saca ventaja estricta al segundo).
 *
 * Por qué cuenta absoluta y no fracción del nombre: MJ/JT suelen escribir una
 * sola palabra distintiva ("Arrau" por "Ampliacion Casa Arrau", "JNC" por
 * "JNC-Vitacura"). Si esa palabra aparece en UN solo proyecto, alcanza. Si la
 * palabra es común y aparece en varios (ej. "Casa"), hay empate → preguntamos
 * en vez de adivinar. Conservador: ante duda real, no resolvemos solos.
 */
function matchByName<T extends NamedMatch>(
  texto: string,
  candidatos: T[]
): MatchResult<T> {
  const t = norm(texto);
  const tWords = new Set(t.split(" ").filter((w) => w.length >= 3));
  if (tWords.size === 0) {
    return { kind: "ninguno", candidates: candidatos };
  }

  const scored = candidatos
    .map((c) => {
      const words = norm(c.name)
        .split(" ")
        .filter((w) => w.length >= 3);
      // score = cantidad de palabras del nombre que aparecen en el texto.
      const hits = words.filter((w) => tWords.has(w)).length;
      return { c, score: hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { kind: "ninguno", candidates: candidatos };
  }

  const best = scored[0];
  const second = scored[1];
  // Match claro: el mejor le saca ventaja estricta al segundo (o es el único).
  if (!second || best.score > second.score) {
    return {
      kind: "exacto",
      match: best.c,
      candidates: scored.map((s) => s.c),
    };
  }
  // Empate en cantidad de palabras → ambiguo, listamos los empatados.
  return {
    kind: "ambiguo",
    candidates: scored.filter((s) => s.score === best.score).map((s) => s.c),
  };
}

/**
 * Resuelve proyecto a partir del texto del mensaje. Considera proyectos
 * no archivados (cotización / ejecución / terminado) — un gasto puede
 * llegar a una obra recién terminada.
 *
 * INCLUYE los centros de costo INTERNOS (isInternal: true) — BLARQ (gastos
 * generales del estudio), CASA, etc. No se compra "para un cliente" pero sí
 * se imputan gastos a ellos (autopistas, bencina, patente → BLARQ). Antes se
 * excluían y MJ no podía mandar una factura de gasto general por el bot.
 */
export async function matchProject(
  texto: string
): Promise<MatchResult<NamedMatch>> {
  const projects = await prisma.project.findMany({
    where: { status: { not: "archivado" } },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
  });
  return matchByName(texto, projects);
}

/**
 * Resuelve categoría (opcional) del texto. Solo categorías que aplican a
 * facturas recibidas (Materiales, Mano de obra, Herramientas, etc.).
 * Si el texto no menciona ninguna, devuelve "ninguno" sin ruido — la
 * categoría es opcional, la suele completar la regla por proveedor.
 */
export async function matchCategory(
  texto: string
): Promise<MatchResult<NamedMatch>> {
  const cats = await prisma.costCategory.findMany({
    where: { appliesTo: { in: ["recibida", "both"] } },
    select: { id: true, name: true },
  });
  return matchByName(texto, cats);
}
