/**
 * SOLO LECTURA sobre la base VIVA. Fotografía de los dos vocabularios que hoy
 * no calzan, para poder proponer cómo homologarlos:
 *
 *   - capítulos de obra (ObraChapter.name) — texto libre desde el PR #331, y
 *     su nombre SALE EN EL PDF DEL CLIENTE.
 *   - categorías del catálogo (PartidaCatalog.category) — lista interna, la
 *     ve solo BLARQ.
 *
 * Importa además cuáles capítulos están en versiones ya enviadas/aprobadas:
 * renombrar esos cambia un documento que el cliente YA vio.
 *
 * GOTCHA: prisma auto-carga `.env` (que apunta a DEV). Hay que pasarle el
 * datasource a mano leyendo `.env.prod`, o este script miente.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
// La lista ÚNICA, importada y NO copiada: una copia acá se desactualiza y el
// diagnóstico pasa a mentir sobre qué calza y qué no (pasó el 2026-08-03).
import { CAPITULOS } from "../src/lib/presupuesto/chapters";

const envProd = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const URL_VIVA = envProd.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();

const prisma = new PrismaClient({ datasources: { db: { url: URL_VIVA } } });


async function main() {
  const host = URL_VIVA.match(/@([^/:]+)/)?.[1] ?? "?";
  console.log("HOST:", host);
  if (!host.includes("shy-morning")) throw new Error("No es la viva — abortando");
  const marcador = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador #64:", marcador?.name, "\n");

  // ── Capítulos de obra ────────────────────────────────────────────────────
  const capitulos = await prisma.obraChapter.findMany({
    select: {
      name: true,
      budgetVersion: { select: { status: true, project: { select: { name: true } } } },
      _count: { select: { items: true } },
    },
  });

  const porNombre = new Map<
    string,
    { veces: number; partidas: number; cerrados: number; obras: Set<string> }
  >();
  for (const c of capitulos) {
    const k = c.name.trim();
    const e =
      porNombre.get(k) ?? { veces: 0, partidas: 0, cerrados: 0, obras: new Set<string>() };
    e.veces++;
    e.partidas += c._count.items;
    // Enviado/aprobado = el cliente ya lo vio. Renombrar ahí toca un documento
    // emitido, no un borrador.
    if (["enviado", "aprobado"].includes(c.budgetVersion.status)) e.cerrados++;
    if (c.budgetVersion.project?.name) e.obras.add(c.budgetVersion.project.name);
    porNombre.set(k, e);
  }

  console.log(`CAPÍTULOS DE OBRA — ${porNombre.size} nombres distintos en ${capitulos.length} capítulos\n`);
  const orden = [...porNombre.entries()].sort((a, b) => b[1].partidas - a[1].partidas);
  for (const [nombre, e] of orden) {
    const calza = (CAPITULOS as readonly string[]).includes(nombre) ? "=" : " ";
    console.log(
      `${calza} ${nombre.padEnd(42)} ${String(e.veces).padStart(3)} versiones · ${String(e.partidas).padStart(4)} partidas · ${String(e.cerrados).padStart(3)} en enviadas/aprobadas · ${e.obras.size} obras`
    );
  }

  // ── Categorías del catálogo ──────────────────────────────────────────────
  const partidas = await prisma.partidaCatalog.findMany({
    select: { category: true },
  });
  const porCat = new Map<string, number>();
  for (const p of partidas) porCat.set(p.category, (porCat.get(p.category) ?? 0) + 1);

  console.log(`\nCATEGORÍAS DEL CATÁLOGO — ${porCat.size} distintas en ${partidas.length} partidas\n`);
  for (const [cat, n] of [...porCat.entries()].sort((a, b) => b[1] - a[1])) {
    const conocida = (CAPITULOS as readonly string[]).includes(cat) ? " " : "!";
    console.log(`${conocida} ${cat.padEnd(42)} ${String(n).padStart(4)} partidas`);
  }

  // ── Los que no calzan ────────────────────────────────────────────────────
  const nombresCap = new Set([...porNombre.keys()]);
  const nombresCat = new Set([...porCat.keys()]);
  console.log("\nCAPÍTULOS SIN CATEGORÍA IGUAL EN EL CATÁLOGO:");
  for (const n of [...nombresCap].filter((n) => !nombresCat.has(n)).sort()) {
    console.log("  ·", n);
  }
  console.log("\nCATEGORÍAS DEL CATÁLOGO QUE NINGÚN CAPÍTULO USA:");
  for (const n of [...nombresCat].filter((n) => !nombresCap.has(n)).sort()) {
    console.log("  ·", n);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
