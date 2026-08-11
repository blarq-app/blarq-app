// Pendiente 154 — reparación puntual de datos: en Cocina Candelaria hay 4
// artefactos guardados con el ambiente "cocina" (minúscula) y 2 con "Cocina".
// Se ven como un solo bloque desde el arreglo del editor, pero dejamos el dato
// parejo. SOLO cambia el texto del ambiente: no toca cantidades ni precios.
//
// No usa `import "dotenv/config"` a propósito (§4.9 del CLAUDE.md): lee el
// DATABASE_URL del archivo que se le pase, para no dudar de a qué base apunta.
//
// Uso:
//   npx tsx scripts/fix-154-candelaria-ambiente-cocina.ts <ruta-env>            (dry-run)
//   npx tsx scripts/fix-154-candelaria-ambiente-cocina.ts <ruta-env> --aplicar  (escribe)
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
if (!envPath) {
  console.error("uso: npx tsx scripts/fix-154-candelaria-ambiente-cocina.ts <ruta-env> [--aplicar]");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

const DESTINO = "Cocina";

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "|", aplicar ? "APLICANDO" : "DRY-RUN (no escribe)", "===");
  // Marcador de base viva (§4.9).
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador base viva → #64:", p64?.name ?? "(no existe)");

  const items = await prisma.artefactoItem.findMany({
    where: {
      room: "cocina",
      budgetVersion: {
        project: { name: { contains: "Candelaria", mode: "insensitive" } },
      },
    },
    select: {
      id: true,
      name: true,
      room: true,
      quantity: true,
      clientPrice: true,
      budgetVersion: {
        select: { version: true, project: { select: { name: true } } },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (items.length === 0) {
    console.log("Nada que cambiar: no hay artefactos con room=\"cocina\" en Candelaria.");
    return;
  }

  console.log(`\nArtefactos a mover de room="cocina" a room="${DESTINO}":`);
  for (const it of items) {
    console.log(
      `  · ${it.name}  (${it.budgetVersion.project.name} ${it.budgetVersion.version}, cant ${it.quantity}, $${it.clientPrice})  [${it.id}]`
    );
  }
  console.log(`\nTotal: ${items.length} registro(s). Solo cambia el campo "room".`);

  if (!aplicar) {
    console.log("\nDRY-RUN: no se escribió nada. Volvé a correrlo con --aplicar para aplicar.");
    return;
  }

  const res = await prisma.artefactoItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { room: DESTINO },
  });
  console.log(`\nActualizados: ${res.count}`);

  const post = await prisma.artefactoItem.findMany({
    where: {
      budgetVersion: {
        project: { name: { contains: "Candelaria", mode: "insensitive" } },
      },
      subcategory: "cocina",
    },
    select: { room: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log("\nEstado final de la cocina de Candelaria:");
  for (const it of post) console.log(`  room="${it.room}"  ${it.name}`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
