// SOLO LECTURA. Snapshot de los avisos del Resumen + los totales de cada obra,
// para correr ANTES y DESPUÉS del cambio de rótulos del pendiente 159 y
// confirmar que los PORCENTAJES y los TOTALES no se movieron (§4.1 de CLAUDE.md:
// metrics.ts no se toca sin snapshot pre/post).
//
// El cambio es solo de texto, así que lo que tiene que salir idéntico es:
//   - la cantidad de avisos por obra
//   - la severidad y el % de cada aviso
//   - cobrado / gastado / utilidad real
// Lo único que puede cambiar es la palabra del rótulo.
//
// Uso: npx tsx scripts/diag-159-snapshot-avisos.ts .env.prod > salida.txt
// NO usa dotenv (leería la base vieja): lee el DATABASE_URL del archivo indicado.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";

const envPath = process.argv[2];
if (!envPath) {
  console.error("uso: npx tsx scripts/diag-159-snapshot-avisos.ts <ruta-env>");
  process.exit(1);
}
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log(`# BASE: ${host}`);
  const projects = await prisma.project.findMany({
    include: PROJECT_METRICS_INCLUDE,
    orderBy: { name: "asc" },
  });
  for (const p of projects) {
    const m = computeProjectMetrics(p as unknown as ProjectWithMetrics);
    console.log(`\n== ${p.name}`);
    console.log(
      `   cobrado ${clp(m.totalCobrado)} · gastado ${clp(m.totalGastado)} · utilidad ${clp(m.utilidadReal)}`
    );
    if (m.alerts.length === 0) console.log("   (sin avisos)");
    for (const a of m.alerts) console.log(`   [${a.severity}] ${a.message}`);
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
