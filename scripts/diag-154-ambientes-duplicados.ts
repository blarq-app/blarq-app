// Diagnóstico SOLO LECTURA (pendiente 154): ambientes que se ven iguales pero
// están guardados distinto ("Cocina" vs "cocina" vs "COCINA ").
//
// No usa `import "dotenv/config"` a propósito (§4.9 del CLAUDE.md): lee el
// DATABASE_URL del archivo que se le pase, así no hay dudas de a qué base
// apunta. Uso:
//   npx tsx scripts/diag-154-ambientes-duplicados.ts ../../../.env.prod [filtroProyecto]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const filtro = process.argv[3] ?? "";
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-154-ambientes-duplicados.ts <ruta-env> [filtroProyecto]");
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

// Misma normalización que usa la app para agrupar ambientes.
function norm(room: string): string {
  return room
    .replace(/_/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  // Marcador de base viva (§4.9): #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Marcador base viva → #64:", p64?.name ?? "(no existe)");
  console.log("");

  const items = await prisma.artefactoItem.findMany({
    where: filtro
      ? {
          budgetVersion: {
            project: { name: { contains: filtro, mode: "insensitive" } },
          },
        }
      : {},
    select: {
      id: true,
      room: true,
      subcategory: true,
      name: true,
      sortOrder: true,
      budgetVersion: {
        select: {
          id: true,
          version: true,
          project: { select: { numeroProyecto: true, name: true } },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Agrupa por (presupuesto, subcategoría, ambiente NORMALIZADO) y reporta
  // solo los casos donde bajo una misma clave normalizada conviven 2+ valores
  // crudos distintos: esos son los bloques duplicados que MJ ve repetidos.
  const grupos = new Map<string, typeof items>();
  for (const it of items) {
    const k = [
      it.budgetVersion.id,
      it.subcategory ?? "sanitario",
      norm(it.room ?? "otro"),
    ].join("|");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(it);
  }

  let casos = 0;
  for (const [k, arr] of grupos) {
    const crudos = [...new Set(arr.map((i) => i.room))];
    if (crudos.length < 2) continue;
    casos++;
    const bv = arr[0].budgetVersion;
    console.log(
      `#${bv.project.numeroProyecto} ${bv.project.name} · ${bv.version} · ${k.split("|")[1]} · ambiente "${k.split("|")[2]}"`
    );
    for (const cr of crudos) {
      const del = arr.filter((i) => i.room === cr);
      console.log(`   room="${cr}" → ${del.length} artefacto(s)`);
      for (const i of del) console.log(`      · ${i.name}  [${i.id}]`);
    }
    console.log("");
  }
  console.log(casos === 0 ? "Sin ambientes duplicados por mayúsculas/espacios." : `Total casos: ${casos}`);
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
