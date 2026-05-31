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
 * Estrategia: para cada candidato, contamos cuántas de sus palabras
 * (de 3+ letras) aparecen en el texto. Gana el de mayor cobertura, siempre
 * que sea único. Empate o cero → no resolvemos solos.
 */
function matchByName<T extends NamedMatch>(
  texto: string,
  candidatos: T[]
): MatchResult<T> {
  const t = norm(texto);
  const tWords = new Set(t.split(" ").filter((w) => w.length >= 3));

  const scored = candidatos
    .map((c) => {
      const words = norm(c.name)
        .split(" ")
        .filter((w) => w.length >= 3);
      if (words.length === 0) return { c, score: 0 };
      const hits = words.filter((w) => tWords.has(w)).length;
      // score = fracción de palabras del nombre que aparecen en el texto.
      return { c, score: hits / words.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { kind: "ninguno", candidates: candidatos };
  }

  const best = scored[0];
  const second = scored[1];
  // Match claro: el mejor cubre al menos la mitad del nombre y le saca
  // ventaja al segundo (o no hay segundo).
  if (best.score >= 0.5 && (!second || best.score > second.score)) {
    return {
      kind: "exacto",
      match: best.c,
      candidates: scored.map((s) => s.c),
    };
  }
  return { kind: "ambiguo", candidates: scored.map((s) => s.c) };
}

/**
 * Resuelve proyecto a partir del texto del mensaje. Considera proyectos
 * no archivados (cotización / ejecución / terminado) — un gasto puede
 * llegar a una obra recién terminada.
 */
export async function matchProject(
  texto: string
): Promise<MatchResult<NamedMatch>> {
  const projects = await prisma.project.findMany({
    where: { status: { not: "archivado" }, isInternal: false },
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
