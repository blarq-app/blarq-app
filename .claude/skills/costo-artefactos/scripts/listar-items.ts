/**
 * READ-ONLY. Vuelca los artefactos de una versión de un proyecto para poder
 * emparejar a mano cada línea de la cotización del proveedor con su ArtefactoItem.
 *
 * Lee DATABASE_URL directo de .env.prod (NO usa dotenv, que carga la base VIEJA
 * ep-solitary-mud — gotcha conocido). Imprime el HOST y aborta si no es la viva.
 *
 * Uso (desde la raíz del repo):
 *   npx tsx .claude/skills/costo-artefactos/scripts/listar-items.ts "Paseo del Sena" [V2]
 *
 * Si no se pasa versión, muestra TODAS las versiones de artefactos y marca cuál
 * es la VIGENTE (la que lee metrics.ts para el resultado). Con versión, vuelca
 * los ítems de esa versión.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { selectVigente } from "../../../../src/lib/projects/selectVersion";

const projectQuery = process.argv[2];
const versionArg = process.argv[3];
if (!projectQuery) {
  console.error('Falta el nombre del proyecto. Ej: ... listar-items.ts "Paseo del Sena" V2');
  process.exit(1);
}

const raw = readFileSync(".env.prod", "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) { console.error("No encontré DATABASE_URL en .env.prod"); process.exit(1); }
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("HOST:", host, host.startsWith("ep-shy-morning") ? "(VIVA ✓)" : "(¡NO es la viva! abortando)");
  if (!host.startsWith("ep-shy-morning")) process.exit(1);

  const p = await prisma.project.findFirst({
    where: { name: { contains: projectQuery, mode: "insensitive" } },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!p) { console.error(`No hay proyecto que contenga "${projectQuery}"`); process.exit(1); }
  console.log(`\nProyecto: #${p.numeroProyecto} ${p.name}\n`);

  const bvs = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: "artefactos" },
    include: { _count: { select: { artefactoItems: true } } },
    orderBy: { createdAt: "asc" },
  });
  const vigente = selectVigente(bvs);

  console.log("Versiones de artefactos (VIGENTE = la que lee metrics.ts para el resultado):");
  for (const bv of bvs) {
    const flag = vigente && bv.id === vigente.id ? "  ← VIGENTE" : "";
    console.log(
      `  ${bv.version.padEnd(6)} status=${bv.status.padEnd(9)} items=${String(bv._count.artefactoItems).padStart(3)}  ${bv.createdAt.toISOString().slice(0, 10)}${flag}`
    );
  }

  if (!versionArg) {
    console.log("\n(pasá una versión como 2º argumento para volcar sus ítems)");
    return;
  }

  const bv = bvs.find((b) => b.version.toLowerCase() === versionArg.toLowerCase());
  if (!bv) { console.error(`\nNo existe la versión ${versionArg} en artefactos`); process.exit(1); }
  if (vigente && bv.id !== vigente.id) {
    console.log(`\n⚠ Ojo: ${bv.version} NO es la versión vigente (${vigente.version}). Cargar el costo`);
    console.log(`  acá NO cambia el resultado ni las alertas hasta que ${bv.version} pase a enviado/aprobado.`);
  }

  const items = await prisma.artefactoItem.findMany({
    where: { budgetVersionId: bv.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, name: true, brand: true, detail: true, room: true,
      subcategory: true, quantity: true, clientPrice: true,
      realCostBlarq: true, catalogId: true,
    },
  });

  console.log(`\n=== ${bv.version} · ${items.length} ítems (copiá el itemId para el JSON de costos) ===\n`);
  for (const it of items) {
    console.log(`itemId: ${it.id}`);
    console.log(`  ${it.room ?? "-"} / ${it.subcategory ?? "-"} · ${it.name}${it.brand ? " · " + it.brand : ""}`);
    if (it.detail) console.log(`  modelo: ${it.detail.replace(/\s+/g, " ").slice(0, 90)}`);
    console.log(
      `  q${it.quantity} · precio cliente ${fmt(it.clientPrice)} (c/IVA) · costo actual ${fmt(it.realCostBlarq)} · catalogId ${it.catalogId ?? "—"}`
    );
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
