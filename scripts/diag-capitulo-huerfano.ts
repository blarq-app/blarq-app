// Diagnóstico SOLO LECTURA: dónde viven las partidas cuyo `chapter` no es una
// de las 8 claves oficiales (hoy quedan invisibles en el editor y en el PDF,
// pero SÍ suman en los totales de metrics.ts).
// Uso: npx tsx scripts/diag-capitulo-huerfano.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) process.exit(1);
const url = m[1].trim();
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
  const items = await prisma.obraItem.findMany({
    where: { chapter: { notIn: OFICIALES } },
    select: {
      id: true,
      chapter: true,
      name: true,
      total: true,
      budgetVersion: {
        select: {
          id: true,
          version: true,
          status: true,
          type: true,
          project: { select: { numeroProyecto: true, name: true } },
        },
      },
    },
  });
  console.log(`Partidas con capítulo fuera de la lista: ${items.length}\n`);
  const porVersion = new Map<string, typeof items>();
  for (const it of items) {
    const k = `#${it.budgetVersion.project.numeroProyecto} ${it.budgetVersion.project.name} · ${it.budgetVersion.version} (${it.budgetVersion.status})`;
    if (!porVersion.has(k)) porVersion.set(k, []);
    porVersion.get(k)!.push(it);
  }
  for (const [k, arr] of porVersion) {
    const suma = arr.reduce((s, i) => s + i.total, 0);
    console.log(`${k} — ${arr.length} partidas, total $${Math.round(suma).toLocaleString("es-CL")}`);
    console.log(`   chapter="${arr[0].chapter}"`);
    for (const it of arr.slice(0, 30)) console.log(`     · ${it.name}`);
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
