/**
 * Cocina Candelaria V6 (borrador): las descripciones de los muebles pasan de
 * TODO MAYÚSCULA a minúscula con la primera letra de las palabras importantes
 * en mayúscula (pedido de MJ, 2026-10-02: "que salgan en minúsculas con las
 * palabras importantes en mayúscula la primera letra").
 *
 *   "MELAMINA BLANCA 18MM, TAPACANTO PVC 0,4MM"
 *     → "Melamina Blanca 18mm, Tapacanto PVC 0,4mm"
 *
 * Reglas (enTitulo):
 *   - Palabras chicas en minúscula (de, en, y, con, para…), salvo al empezar
 *     el texto o después de un punto.
 *   - Medidas: el número queda igual y la unidad en minúscula (18MM → 18mm).
 *   - Siglas conocidas (PVC, MDF, HPL…) y códigos con números (S027) quedan
 *     como están.
 *   - El resto: primera letra mayúscula, lo demás minúscula (SÓLIDA → Sólida).
 *   - Ortografía: solo la tilde de "Mueblería", que MJ aprobó al ver la
 *     tabla (CORRECCIONES). El resto queda con las mismas letras.
 *
 * Solo toca la V6 (borrador) y solo los textos que están ENTEROS en
 * mayúscula: los que MJ ya escribió en minúscula ("Alto en sector
 * encimera") quedan igual. Las V5 (Vesto, Egger, Gizir) no se tocan: están
 * enviadas o aprobadas. Los nombres de los componentes (CUERPO INTERIOR…)
 * tampoco: la app los muestra siempre en mayúscula. No toca plata.
 *
 * Escribe en la base VIVA. Lee la conexión de .env.prod a propósito (NO usa
 * dotenv, porque .env apunta a la vieja).
 *
 *   npx tsx scripts/candelaria-v6-descripciones-minusculas.ts           → solo muestra
 *   npx tsx scripts/candelaria-v6-descripciones-minusculas.ts --write   → guarda
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const env = fs.readFileSync(ENV_PROD, "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!url || !url.includes("ep-shy-morning")) {
  throw new Error(`${ENV_PROD} no apunta a la base viva (ep-shy-morning)`);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const WRITE = process.argv.includes("--write");

const V6_ID = "cmumnf1k50001jp04libmhifp";

const CHICAS = new Set([
  "de", "del", "la", "las", "el", "los", "en", "y", "e", "o", "u", "a", "al",
  "con", "sin", "por", "para", "x", "un", "una",
]);
const SIGLAS = new Set(["PVC", "MDF", "HPL", "LED", "OSB", "MDP", "PU", "ABS"]);
const MEDIDA = /^(\d+(?:[.,]\d+)?)(MM|CM|MTS|MT|M|KG|L)$/i;
// Correcciones de ortografía aprobadas por MJ (2026-10-02).
const CORRECCIONES: Record<string, string> = { Muebleria: "Mueblería" };

function palabra(p: string, alComienzo: boolean): string {
  if (!p) return p;
  const m = p.match(MEDIDA);
  if (m) return m[1] + m[2].toLowerCase();
  if (/\d/.test(p)) return p; // códigos como S027
  if (SIGLAS.has(p.toUpperCase())) return p.toUpperCase();
  const min = p.toLocaleLowerCase("es-CL");
  if (!alComienzo && CHICAS.has(min)) return min;
  const titulo = min.charAt(0).toLocaleUpperCase("es-CL") + min.slice(1);
  return CORRECCIONES[titulo] ?? titulo;
}

export function enTitulo(texto: string): string {
  // Separa palabras de espacios y signos, sin perder nada.
  const partes = texto.split(/(\s+|[,.;:()/-])/);
  let alComienzo = true;
  return partes
    .map((parte) => {
      if (!parte) return parte;
      if (/^\s+$/.test(parte) || /^[,;:()/-]$/.test(parte)) return parte;
      if (parte === ".") {
        alComienzo = true;
        return parte;
      }
      const r = palabra(parte, alComienzo);
      alComienzo = false;
      return r;
    })
    .join("");
}

// ¿Está entero en mayúscula? (tiene letras y ninguna minúscula)
function enMayuscula(s: string): boolean {
  return /\p{L}/u.test(s) && s === s.toLocaleUpperCase("es-CL");
}

async function main() {
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  if (p64?.name !== "Paseo del Sena") throw new Error("marcador #64 no calza: no es la base viva");
  const v = await prisma.budgetVersion.findUnique({
    where: { id: V6_ID },
    select: { version: true, status: true, project: { select: { name: true } } },
  });
  if (!v || v.status !== "borrador") throw new Error(`la V6 no está en borrador (${v?.status})`);
  console.log(`${v.project.name} ${v.version} (${v.status}). Modo: ${WRITE ? "GUARDAR" : "solo mostrar"}\n`);

  const items = await prisma.muebleItem.findMany({
    where: { budgetVersionId: V6_ID },
    orderBy: { sortOrder: "asc" },
    include: { details: { orderBy: { sortOrder: "asc" } } },
  });

  const cambiosDesc: { id: string; antes: string; despues: string; donde: string }[] = [];
  const cambiosMat: { id: string; antes: string; despues: string; donde: string }[] = [];
  for (const it of items) {
    const d = it.descriptionGeneral ?? "";
    if (enMayuscula(d)) {
      cambiosDesc.push({ id: it.id, antes: d, despues: enTitulo(d), donde: `${it.itemNumber} ${it.name} (descripción)` });
    }
    for (const det of it.details) {
      if (enMayuscula(det.material)) {
        cambiosMat.push({ id: det.id, antes: det.material, despues: enTitulo(det.material), donde: `${it.itemNumber} ${det.name}` });
      }
    }
  }
  for (const c of [...cambiosDesc, ...cambiosMat]) {
    console.log(`${c.donde}\n   antes:   ${c.antes}\n   después: ${c.despues}`);
  }
  console.log(`\n${cambiosDesc.length} descripción(es) + ${cambiosMat.length} materialidad(es).`);

  if (!WRITE) {
    console.log("Solo mostrar: no se guardó nada. Correr con --write para guardar.");
    return;
  }
  await prisma.$transaction([
    ...cambiosDesc.map((c) =>
      prisma.muebleItem.update({ where: { id: c.id }, data: { descriptionGeneral: c.despues } })
    ),
    ...cambiosMat.map((c) =>
      prisma.muebleDetail.update({ where: { id: c.id }, data: { material: c.despues } })
    ),
  ]);
  console.log("Guardado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
