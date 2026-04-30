// Compara los cálculos contables entre la lógica del page.tsx (que vamos
// a eliminar en B1) y `computeProjectMetrics` de metrics.ts (la fuente
// única que va a quedar). Si hay diferencias mayores a $1, las reporta.
//
// Sirve para asegurarnos que el refactor de B1 no rompa números que MJ ya
// está viendo bien.
//
// Uso: npx tsx scripts/compare-metrics.ts
//
// Output: tabla por proyecto + diff agregado.

import { prisma } from "../src/lib/prisma";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";

const TOLERANCE = 1; // peso(s) — para absorber rounds

// Lógica equivalente a la que vive HOY en src/app/(dashboard)/proyectos/[id]/resumen/page.tsx.
// La replicamos acá literal para poder comparar contra computeProjectMetrics.
function legacyMetricsFromPage(p: ProjectWithMetrics) {
  function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
    const aprobado = arr
      .filter((b) => b.status === "aprobado")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return (
      aprobado ??
      arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    );
  }
  const lastObra = bestVersion(p.budgetVersions.filter((b) => b.type === "obra"));
  const lastMuebles = bestVersion(p.budgetVersions.filter((b) => b.type === "muebles"));
  const lastArtefactos = bestVersion(p.budgetVersions.filter((b) => b.type === "artefactos"));

  const obraCostoDirecto = lastObra
    ? lastObra.obraItems.reduce((s, i) => s + i.total, 0)
    : 0;
  const obraGG = obraCostoDirecto * ((lastObra?.ggPercentage || 0) / 100);
  const obraSubtotal = obraCostoDirecto + obraGG;
  const obraUtilidad = obraSubtotal * ((lastObra?.utilityPercentage || 0) / 100);
  const obraNeto = obraSubtotal + obraUtilidad;
  const obraTotal = obraNeto * 1.19;

  const mueblesItems = lastMuebles
    ? lastMuebles.muebleChapters.flatMap((c) => c.items)
    : [];
  const mueblesTotal = mueblesItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );

  const artefactosTotal = lastArtefactos
    ? lastArtefactos.artefactoItems.reduce((s, i) => s + i.clientPrice, 0)
    : 0;

  const totalVendido = obraTotal + mueblesTotal + artefactosTotal;

  const facturasEmitidas = p.invoices.filter((i) => i.type === "emitida");
  const facturasRecibidas = p.invoices.filter((i) => i.type === "recibida");
  const totalCobrado = facturasEmitidas.reduce((s, i) => s + i.totalAmount, 0);
  const totalGastado = facturasRecibidas.reduce((s, i) => s + i.netAmount, 0);

  const totalPagadoMaestros = p.estadosPago
    .filter((ep) => ep.status === "pagado")
    .reduce((sum, ep) => {
      const prev = p.estadosPago
        .filter((q) => q.number < ep.number && q.status === "pagado")
        .flatMap((q) => q.items);
      const prevMap = new Map<string, number>();
      prev.forEach((i) =>
        prevMap.set(
          i.lineageId,
          Math.max(prevMap.get(i.lineageId) || 0, i.pctAccumulated)
        )
      );
      const thisAmount = ep.items.reduce((s, i) => {
        const prevPct = prevMap.get(i.lineageId) || 0;
        return s + i.laborTotal * ((i.pctAccumulated - prevPct) / 100);
      }, 0);
      return sum + thisAmount;
    }, 0);

  const utilidadReal = totalCobrado - totalGastado - totalPagadoMaestros;

  return {
    totalVendido,
    totalCobrado,
    totalGastado,
    totalPagadoMaestros,
    utilidadReal,
    obraTotal,
    mueblesTotal,
    artefactosTotal,
  };
}

async function main() {
  const projects = await prisma.project.findMany({
    where: { isInternal: false },
    orderBy: { numeroProyecto: "asc" },
    include: PROJECT_METRICS_INCLUDE,
  });

  console.log(`Comparando ${projects.length} proyectos no-internos...\n`);
  console.log(
    "Proyecto".padEnd(35) +
      "Campo".padEnd(20) +
      "page.tsx".padStart(15) +
      "metrics".padStart(15) +
      "diff".padStart(15)
  );
  console.log("─".repeat(100));

  let diffsFound = 0;
  let exactMatches = 0;
  let withinTolerance = 0;

  for (const p of projects) {
    const legacy = legacyMetricsFromPage(p as ProjectWithMetrics);
    const metrics = computeProjectMetrics(p as ProjectWithMetrics);

    const pairs: Array<[string, number, number]> = [
      ["totalAcordado", legacy.totalVendido, metrics.totalAcordado],
      ["totalCobrado", legacy.totalCobrado, metrics.totalCobrado],
      ["totalGastado", legacy.totalGastado, metrics.totalGastado],
      ["totalPagadoMaestros", legacy.totalPagadoMaestros, metrics.totalPagadoMaestros],
      ["utilidadReal", legacy.utilidadReal, metrics.utilidadReal],
    ];

    const projectLabel = `${p.numeroProyecto ?? "—"} ${p.name}`.slice(0, 33);
    let projectHasDiff = false;

    for (const [name, l, m] of pairs) {
      const diff = m - l;
      if (Math.abs(diff) < 0.01) {
        exactMatches++;
        continue;
      }
      if (Math.abs(diff) <= TOLERANCE) {
        withinTolerance++;
        continue;
      }
      // Diff real
      diffsFound++;
      if (!projectHasDiff) {
        console.log(`\n${projectLabel}`);
        projectHasDiff = true;
      }
      console.log(
        "".padEnd(35) +
          name.padEnd(20) +
          formatNum(l).padStart(15) +
          formatNum(m).padStart(15) +
          formatDiff(diff).padStart(15)
      );
    }
  }

  console.log("\n─".repeat(100));
  console.log(`✓ Exactos:          ${exactMatches}`);
  console.log(`~ Tolerancia ±${TOLERANCE}:  ${withinTolerance}`);
  console.log(`⚠ Diffs reales:     ${diffsFound}`);

  if (diffsFound === 0) {
    console.log(
      `\n✅ Todos los valores coinciden — refactor B1 es seguro.`
    );
  } else {
    console.log(
      `\n⚠ Hay diferencias. Revisar antes de mergear B1.`
    );
  }

  await prisma.$disconnect();
}

function formatNum(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

function formatDiff(d: number): string {
  if (d > 0) return `+${formatNum(d)}`;
  return formatNum(d);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
