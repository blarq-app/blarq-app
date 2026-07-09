// Snapshot SOLO LECTURA de los totales por proyecto (Resumen + Fondo de
// Sueldos + Cuadro Resumen), para comparar ANTES/DESPUÉS del cambio de
// selección de versión. Usa las funciones REALES (metrics/fondo/cuadro).
//
// Uso:
//   npx tsx scripts/diag-snapshot-resumen.ts <ruta-env> <archivo-salida.json>
// Ej ANTES:   ... .env.prod snapshot-resumen-antes.json
//    DESPUÉS: ... .env.prod snapshot-resumen-despues.json
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";
import {
  computeFondoSueldos,
  PROJECT_FONDO_INCLUDE,
  type ProjectWithFondo,
} from "../src/lib/banco/fondoSueldos";
import {
  computeCuadroResumen,
  type CuadroResumenInput,
} from "../src/lib/projects/cuadroResumen";

const envPath = process.argv[2] ?? ".env.prod";
const outPath = process.argv[3] ?? "snapshot-resumen.json";
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Proyectos representativos (§4.1): anexo, muebles/artefactos sucesivas,
// enviado-no-aprobado, muebles enviado, y borrador-solo.
const TARGETS = [
  "Francisco de Aguirre", // anexo (2 obras aprobadas)
  "Paseo del Sena",       // artefactos/muebles con versiones sucesivas
  "Los Halcones",         // obra solo enviada (sin aprobar)
  "Depto Colon",          // muebles solo enviados
  "Cocina Candelaria",    // obra solo borrador
];

async function main() {
  console.log(`=== ENV: ${envPath} | HOST: ${host} → ${outPath} ===`);
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  console.log(`Marcador: #64 = ${p64?.name} (viva = "Paseo del Sena")`);

  const snapshot: Record<string, unknown> = {};

  // "ALL" como 4º arg → todos los proyectos con presupuestos; sino los TARGETS.
  const all = process.argv[4] === "ALL";
  let bases: { id: string; name: string; numeroProyecto: number | null }[];
  if (all) {
    bases = await prisma.project.findMany({
      where: { budgetVersions: { some: {} } },
      select: { id: true, name: true, numeroProyecto: true },
      orderBy: { numeroProyecto: "asc" },
    });
  } else {
    bases = [];
    for (const nombre of TARGETS) {
      const b = await prisma.project.findFirst({
        where: { name: { contains: nombre, mode: "insensitive" } },
        select: { id: true, name: true, numeroProyecto: true },
      });
      if (b) bases.push(b);
    }
  }

  for (const base of bases) {

    const pMetrics = (await prisma.project.findUnique({
      where: { id: base.id },
      include: PROJECT_METRICS_INCLUDE,
    })) as ProjectWithMetrics;
    const pFondo = (await prisma.project.findUnique({
      where: { id: base.id },
      include: PROJECT_FONDO_INCLUDE,
    })) as ProjectWithFondo;

    // El cuadro necesita invoices con payments (para el pagado). Los traemos
    // aparte con esa relación.
    const invoicesCuadro = await prisma.invoice.findMany({
      where: { projectId: base.id },
      include: {
        category: { select: { name: true } },
        payments: { select: { amountApplied: true, bankMovement: { select: { date: true } } } },
      },
    });

    const m = computeProjectMetrics(pMetrics);
    const f = computeFondoSueldos(pFondo);
    const c = computeCuadroResumen({
      invoices: invoicesCuadro,
      budgets: pMetrics.budgetVersions,
    } as unknown as CuadroResumenInput);

    snapshot[base.name] = {
      numero: base.numeroProyecto,
      metrics: {
        totalAcordado: Math.round(m.totalAcordado),
        totalCobrado: Math.round(m.totalCobrado),
        totalGastado: Math.round(m.totalGastado),
        utilidadReal: Math.round(m.utilidadReal),
        utilidadProyectada: Math.round(m.utilidadProyectada),
      },
      fondo: {
        fondoGenerado: Math.round(f.fondoGenerado),
        fondoObraGenerado: Math.round(f.fondoObraGenerado),
        fondoMueblesGenerado: Math.round(f.fondoMueblesGenerado),
        obraTotalAcordado: Math.round(f.obraTotalAcordado),
      },
      cuadro: {
        totalAcordado: Math.round(c.totalAcordado),
        totalPagado: Math.round(c.totalPagado),
      },
    };
  }

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nGuardado ${outPath}:`);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); }).finally(() => prisma.$disconnect());
