/**
 * Prueba de regresión del PDF de obra: comprueba que la agrupación por
 * capítulos que produce el modelo NUEVO (filas de ObraChapter) es idéntica,
 * versión por versión, a la que producía el modelo VIEJO (la clave de texto
 * `chapter` + la tabla fija de 8 capítulos de lib/utils.ts).
 *
 * Compara la secuencia completa que dibuja el PDF: número de capítulo, nombre
 * del capítulo tal cual sale impreso, y el orden de las partidas adentro. Si
 * las dos secuencias coinciden, el PDF no puede haber cambiado — es la misma
 * lista, con los mismos títulos, en el mismo orden.
 *
 * Uso:
 *   npx tsx scripts/verify-pdf-sin-cambios.ts <ruta-env>
 *   npx tsx scripts/verify-pdf-sin-cambios.ts <ruta-env> --simular
 *
 * --simular arma los capítulos EN MEMORIA, igual que los armaría la migración,
 * sin escribir nada. Sirve para correr esto contra la base VIVA antes de
 * tocarla y ver de antemano si algún PDF de MJ cambiaría.
 *
 * Solo lectura en los dos modos.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { groupByChapter } from "../src/lib/presupuesto/chapters";

const envPath = process.argv[2] ?? ".env";
const SIMULAR = process.argv.includes("--simular");
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

// La tabla fija que tenía lib/utils.ts (OBRA_CHAPTERS) hasta este cambio:
// clave → nombre impreso en el PDF (pdfLabel) y posición.
const VIEJO: Record<string, { pdfLabel: string; index: number }> = {
  demoliciones: { pdfLabel: "DEMOLICIONES", index: 1 },
  obra_gruesa: { pdfLabel: "OBRA GRUESA", index: 2 },
  reparaciones: { pdfLabel: "REPARACIONES", index: 3 },
  sanitarias: { pdfLabel: "INSTALACIONES SANITARIAS Y GASFITERIA", index: 4 },
  electricas: { pdfLabel: "INSTALACIONES ELECTRICAS", index: 5 },
  terminaciones: { pdfLabel: "TERMINACIONES", index: 6 },
  limpieza: { pdfLabel: "LIMPIEZA Y ASEO", index: 7 },
  adicionales: { pdfLabel: "ADICIONALES", index: 8 },
};

type Partida = {
  id: string;
  name: string;
  sortOrder: number;
  chapter: string;
  chapterId: string | null;
  subChapter: string | null;
  total: number;
  noCobrado: boolean;
};

// Lo que dibujaba el PDF ANTES: recorrer las 8 claves en orden, filtrar las
// partidas de cada una, saltar los capítulos vacíos, renumerar 1,2,3…
function secuenciaVieja(items: Partida[]): string[] {
  const out: string[] = [];
  let n = 0;
  for (const [clave, ch] of Object.entries(VIEJO).sort(
    (a, b) => a[1].index - b[1].index
  )) {
    const propias = items
      .filter((i) => i.chapter === clave)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (propias.length === 0) continue;
    n++;
    out.push(`${n} ${ch.pdfLabel}`);
    for (const p of propias) out.push(`   ${p.name}`);
  }
  return out;
}

// Lo que dibuja el PDF AHORA: mismo helper que usa el renderer de verdad.
function secuenciaNueva(
  chapters: { id: string; name: string; sortOrder: number }[],
  items: Partida[]
): string[] {
  const out: string[] = [];
  for (const g of groupByChapter(chapters, items)) {
    out.push(`${g.index} ${g.chapter.name}`);
    for (const p of g.items) out.push(`   ${p.name}`);
  }
  return out;
}

// Reproduce en memoria lo que crearía la migración: una fila de capítulo por
// cada clave que HOY tiene partidas, con el nombre formal y el orden de
// siempre. Las claves que no son ninguna de las 8 van al final.
function capitulosSimulados(items: Partida[]) {
  const claves = [...new Set(items.map((i) => i.chapter))].sort((a, b) => {
    const ia = VIEJO[a]?.index ?? 90;
    const ib = VIEJO[b]?.index ?? 90;
    return ia - ib;
  });
  return claves.map((clave, i) => ({
    id: `sim:${clave}`,
    name: VIEJO[clave]?.pdfLabel ?? clave.replace(/_/g, " ").toUpperCase().trim(),
    sortOrder: i,
  }));
}

async function main() {
  console.log(`=== PDF DE OBRA: ANTES vs DESPUES ===`);
  console.log(`ENV: ${envPath} | HOST: ${host}`);
  console.log(
    `MODO: ${SIMULAR ? "SIMULADO (no escribe, arma los capítulos en memoria)" : "real (lee los capítulos ya migrados)"}\n`
  );

  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "obra", obraItems: { some: {} } },
    include: {
      project: { select: { numeroProyecto: true, name: true } },
      // En modo simulado NO se pide la tabla de capítulos: contra la base viva
      // todavía no existe (esa es la gracia de simular antes de migrar).
      ...(SIMULAR
        ? {}
        : { obraChapters: { orderBy: { sortOrder: "asc" as const } } }),
      obraItems: {
        orderBy: { sortOrder: "asc" },
        // Campos explícitos: en modo simulado la columna chapterId todavía no
        // existe en la base viva, así que no se puede pedir el modelo entero.
        select: {
          id: true,
          name: true,
          sortOrder: true,
          chapter: true,
          subChapter: true,
          total: true,
          noCobrado: true,
          ...(SIMULAR ? {} : { chapterId: true }),
        },
      },
    },
  });

  let iguales = 0;
  const distintas: string[] = [];

  for (const v of versiones) {
    const etiqueta = `#${v.project.numeroProyecto} ${v.project.name} · ${v.version}`;
    // El PDF del cliente deja fuera las partidas NO COBRADO; comparamos con el
    // mismo filtro que usa el renderer.
    const items = v.obraItems.filter((i) => !i.noCobrado) as unknown as Partida[];
    const antes = secuenciaVieja(items);
    const capitulos = SIMULAR
      ? capitulosSimulados(items)
      : (v as { obraChapters: { id: string; name: string; sortOrder: number }[] })
          .obraChapters;
    // En modo simulado las partidas todavía no tienen chapterId: se lo damos
    // en memoria, igual que haría la migración.
    const itemsConCapitulo = SIMULAR
      ? items.map((i) => ({ ...i, chapterId: `sim:${i.chapter}` }))
      : items;
    const despues = secuenciaNueva(capitulos, itemsConCapitulo);

    if (antes.join("\n") === despues.join("\n")) {
      iguales++;
      console.log(`  IGUAL   ${etiqueta}  (${antes.length} líneas)`);
      continue;
    }

    distintas.push(etiqueta);
    console.log(`\n  DISTINTO  ${etiqueta}`);
    const max = Math.max(antes.length, despues.length);
    for (let i = 0; i < max; i++) {
      if (antes[i] !== despues[i]) {
        console.log(`      antes:   ${antes[i] ?? "(nada)"}`);
        console.log(`      después: ${despues[i] ?? "(nada)"}`);
      }
    }
    console.log("");
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`  Versiones idénticas: ${iguales} de ${versiones.length}`);
  if (distintas.length > 0) {
    console.log(`  Versiones con diferencias: ${distintas.length}`);
    for (const d of distintas) console.log(`    · ${d}`);
    console.log(
      `\n  (Una diferencia SOLO es esperable donde el capítulo viejo no era\n` +
        `   ninguna de las 8 claves oficiales: esas partidas no se imprimían.)`
    );
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
