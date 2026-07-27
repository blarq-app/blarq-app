// Diagnóstico SOLO LECTURA: qué valores de `chapter` hay hoy en ObraItem y
// EstadoPagoItem, en cuántas versiones de presupuesto, y si hay valores fuera
// de las 8 claves oficiales de OBRA_CHAPTERS.
// Uso: npx tsx scripts/diag-capitulos-obra.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const OFICIALES = [
  "demoliciones",
  "obra_gruesa",
  "reparaciones",
  "sanitarias",
  "electricas",
  "terminaciones",
  "limpieza",
  "adicionales",
];

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===\n");

  const versionesObra = await prisma.budgetVersion.count({
    where: { type: "obra" },
  });
  const totalItems = await prisma.obraItem.count();
  console.log(`Versiones de presupuesto tipo obra: ${versionesObra}`);
  console.log(`ObraItem totales: ${totalItems}\n`);

  const porChapter = await prisma.obraItem.groupBy({
    by: ["chapter"],
    _count: { _all: true },
  });
  console.log("--- ObraItem.chapter (valores distintos) ---");
  for (const g of porChapter.sort((a, b) => b._count._all - a._count._all)) {
    const flag = OFICIALES.includes(g.chapter) ? "" : "   <-- FUERA DE LA LISTA";
    console.log(`  ${g.chapter.padEnd(20)} ${String(g._count._all).padStart(5)}${flag}`);
  }

  const porEp = await prisma.estadoPagoItem.groupBy({
    by: ["chapter"],
    _count: { _all: true },
  });
  console.log("\n--- EstadoPagoItem.chapter (valores distintos) ---");
  for (const g of porEp.sort((a, b) => b._count._all - a._count._all)) {
    const flag = OFICIALES.includes(g.chapter) ? "" : "   <-- FUERA DE LA LISTA";
    console.log(`  ${g.chapter.padEnd(20)} ${String(g._count._all).padStart(5)}${flag}`);
  }

  // Cuántos capítulos distintos usa cada versión de obra (para dimensionar
  // cuántas filas de capítulo va a crear la migración).
  const items = await prisma.obraItem.findMany({
    select: { budgetVersionId: true, chapter: true },
  });
  const porVersion = new Map<string, Set<string>>();
  for (const it of items) {
    if (!porVersion.has(it.budgetVersionId))
      porVersion.set(it.budgetVersionId, new Set());
    porVersion.get(it.budgetVersionId)!.add(it.chapter);
  }
  let totalCaps = 0;
  for (const s of porVersion.values()) totalCaps += s.size;
  console.log(
    `\nVersiones con al menos una partida: ${porVersion.size}` +
      `\nFilas de capítulo que crearía la migración: ${totalCaps}` +
      `\nPromedio de capítulos por versión: ${(totalCaps / Math.max(1, porVersion.size)).toFixed(1)}`
  );

  // EPs y si tienen budgetVersionId (los legacy con null no pueden leer los
  // capítulos desde la versión → necesitan el snapshot del nombre).
  const eps = await prisma.estadoPago.count();
  const epsSinVersion = await prisma.estadoPago.count({
    where: { budgetVersionId: null },
  });
  console.log(`\nEstados de pago: ${eps} (sin budgetVersionId: ${epsSinVersion})`);

  // Capítulos de muebles, para comparar el orden de magnitud.
  const mch = await prisma.muebleChapter.count();
  console.log(`MuebleChapter (referencia): ${mch}`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
