// Diagnóstico SOLO LECTURA: busca cotizaciones de muebles con líneas de
// herraje y con componentes, para tener un caso donde probar el arrastre.
// Uso: npx tsx scripts/diag-140-buscar-cotizacion-muebles.ts [ruta-env]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env";
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===\n");

  const items = await prisma.muebleItem.findMany({
    where: { kind: "herrajes" },
    include: {
      herrajes: { orderBy: { sortOrder: "asc" } },
      chapter: {
        include: {
          budgetVersion: { include: { project: true } },
        },
      },
    },
  });

  for (const it of items) {
    if (it.herrajes.length === 0) continue;
    const bv = it.chapter.budgetVersion;
    const suma = it.herrajes.reduce((s, h) => s + h.costNet * h.quantity, 0);
    console.log(
      `${bv.project.name} ${bv.version} · cap "${it.chapter.name}" · partida "${it.name}"`,
    );
    console.log(`  /proyectos/${bv.projectId}/presupuesto/${bv.id}`);
    console.log(
      `  ${it.herrajes.length} líneas · suma costo ${Math.round(suma)} · costDistributor ${Math.round(it.costDistributor)} · c/IVA ${Math.round(it.clientPriceIva)}`,
    );
    const sectores = [...new Set(it.herrajes.map((h) => h.sector || "(sin)"))];
    console.log(`  sectores: ${sectores.join(", ")}`);
    console.log("");
  }

  // Partidas con más componentes (para probar el arrastre de componentes).
  const conDetalles = await prisma.muebleItem.findMany({
    where: { details: { some: {} } },
    include: {
      details: { orderBy: { sortOrder: "asc" } },
      chapter: { include: { budgetVersion: { include: { project: true } } } },
    },
  });
  conDetalles.sort((a, b) => b.details.length - a.details.length);
  console.log("── PARTIDAS CON MÁS COMPONENTES ──");
  for (const it of conDetalles.slice(0, 5)) {
    const bv = it.chapter.budgetVersion;
    console.log(
      `  ${bv.project.name} ${bv.version} · "${it.name}" · ${it.details.length} comp: ${it.details.map((d) => d.name).join(" | ")}`,
    );
    console.log(`     /proyectos/${bv.projectId}/presupuesto/${bv.id}`);
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
