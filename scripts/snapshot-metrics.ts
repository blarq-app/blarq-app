// Snapshot de los totales de todos los proyectos. Sirve para correr
// pre/post de un cambio masivo y diff.
//
// Uso:
//   DATABASE_URL='...' npx tsx scripts/snapshot-metrics.ts > /tmp/pre.txt
//   ... cambio ...
//   DATABASE_URL='...' npx tsx scripts/snapshot-metrics.ts > /tmp/post.txt
//   diff /tmp/pre.txt /tmp/post.txt

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeProjectMetrics, PROJECT_METRICS_INCLUDE } from "../src/lib/projects/metrics";

async function main() {
  const projects = await prisma.project.findMany({
    include: PROJECT_METRICS_INCLUDE,
    orderBy: { name: "asc" },
  });

  // Header
  const cols = [
    "name",
    "totalAcordado",
    "totalAcordadoNeto",
    "totalCobrado",
    "totalCobradoNeto",
    "totalGastado",
    "totalGastadoConIva",
    "utilidadReal",
    "utilidadProyectada",
  ];
  console.log(cols.join("\t"));

  for (const p of projects) {
    const m = computeProjectMetrics(p as any);
    const row: any = { name: p.name };
    for (const c of cols.slice(1)) {
      row[c] = Math.round((m as any)[c] ?? 0);
    }
    console.log(cols.map((c) => row[c]).join("\t"));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
