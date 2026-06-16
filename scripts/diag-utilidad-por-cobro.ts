// SOLO LECTURA: corre el motor de "utilidad por cobro" sobre proyectos reales
// de PROD para validar los números contra lo que MJ calcula a mano.
//
// Uso:
//   npx tsx scripts/diag-utilidad-por-cobro.ts            → lista proyectos candidatos
//   npx tsx scripts/diag-utilidad-por-cobro.ts "Portofino" → desglose de ese proyecto
//
// No escribe NADA. Apunta a .env.prod.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  computeUtilidadPorCobro,
  PROJECT_UTILIDAD_INCLUDE,
  type ProjectWithUtilidad,
} from "../src/lib/banco/utilidadPorCobro";

const prodUrl = readFileSync(".env.prod", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  ?.replace(/^DATABASE_URL=/, "").replace(/^["']|["']$/g, "").trim();
if (!prodUrl?.includes("ep-shy-morning")) throw new Error("falta URL prod");
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (n: number) => (n * 100).toFixed(1) + "%";

async function main() {
  const filtro = process.argv[2];

  if (!filtro) {
    // Listar candidatos: proyectos no internos con presupuesto obra o muebles.
    const projects = await prisma.project.findMany({
      where: { isInternal: false },
      select: {
        name: true,
        numeroProyecto: true,
        status: true,
        budgetVersions: { select: { type: true, status: true } },
        invoices: { where: { type: "emitida" }, select: { id: true } },
      },
      orderBy: { numeroProyecto: "desc" },
    });
    console.log("PROYECTO".padEnd(34), "ESTADO".padEnd(12), "TIPOS", "COBROS");
    console.log("-".repeat(70));
    for (const p of projects) {
      const tipos = [...new Set(p.budgetVersions.filter((b) => b.status === "aprobado").map((b) => b.type))];
      if (tipos.length === 0) continue;
      console.log(
        (p.name ?? "?").slice(0, 33).padEnd(34),
        p.status.padEnd(12),
        tipos.join("+").padEnd(20),
        p.invoices.length
      );
    }
    console.log("\nCorré de nuevo con un nombre: npx tsx scripts/diag-utilidad-por-cobro.ts \"<nombre>\"");
    return;
  }

  const project = await prisma.project.findFirst({
    where: { name: { contains: filtro, mode: "insensitive" }, isInternal: false },
    include: PROJECT_UTILIDAD_INCLUDE,
  });
  if (!project) {
    console.log(`No encontré proyecto con "${filtro}"`);
    return;
  }

  const r = computeUtilidadPorCobro(project as unknown as ProjectWithUtilidad);

  console.log("=".repeat(72));
  console.log(`PROYECTO: ${project.name}  (estado: ${project.status})`);
  console.log("=".repeat(72));

  console.log("\nPRESUPUESTO");
  console.log(`  Obra    — GG total: ${fmt(r.obraGGTotal).padStart(14)}   acordado: ${fmt(r.obraTotalAcordado)}`);
  console.log(`            tasa utilidad obra (GG/acordado): ${pct(r.tasaUtilidadObra)}`);
  console.log(`  Muebles — util. estimada: ${fmt(r.utilMueblesEstimadaTotal).padStart(14)}   acordado: ${fmt(r.mueblesTotalAcordado)}`);
  console.log(`            tasa utilidad muebles: ${pct(r.tasaUtilidadMuebles)}`);

  console.log("\nUTILIDAD POR COBRO (cada factura emitida cobrada):");
  console.log(
    "  " + "FECHA".padEnd(12) + "FOLIO".padEnd(10) + "CONCEPTO".padEnd(12) +
    "COBRADO".padStart(15) + "UTILIDAD".padStart(14) + "  → TRANSFERIR"
  );
  console.log("  " + "-".repeat(78));
  for (const c of r.cobros) {
    console.log(
      "  " +
        c.fecha.toISOString().slice(0, 10).padEnd(12) +
        (c.folio ?? "—").padEnd(10) +
        (c.concepto + (c.esNotaCredito ? " (NC)" : "")).padEnd(12) +
        fmt(c.cobradoCIVA).padStart(15) +
        fmt(c.utilidad).padStart(14) +
        "   " + fmt(c.sugerenciaTraspaso)
    );
  }

  console.log("\nTOTALES (topados al GG/util del presupuesto)");
  console.log(`  Utilidad obra reconocida:    ${fmt(r.utilidadObraReconocida)}`);
  console.log(`  Utilidad muebles reconocida: ${fmt(r.utilidadMueblesReconocida)} (estimada)`);
  if (r.sobreCobroObra) console.log(`  ⚠ ALERTA: cobraste más OBRA que el presupuesto → topado. Revisar adicionales / etiquetado de cobros.`);
  if (r.sobreCobroMuebles) console.log(`  ⚠ ALERTA: cobraste más MUEBLES que el presupuesto → topado.`);
  if (r.proyectoTerminado && r.utilidadMueblesReal !== null) {
    console.log(`\n  CIERRE MUEBLES (proyecto terminado):`);
    console.log(`    Cobrado neto muebles:  ${fmt(r.mueblesCobradoNeto ?? 0)}`);
    console.log(`    Gastado neto muebles:  ${fmt(r.mueblesGastadoNeto ?? 0)}`);
    console.log(`    Utilidad REAL muebles: ${fmt(r.utilidadMueblesReal)}`);
    console.log(`    Ajuste final (real − estimada reconocida): ${fmt(r.ajusteFinalMuebles ?? 0)}`);
  }
  console.log(`\n  >>> UTILIDAD TOTAL RECONOCIDA (a tener en Sueldos por este proyecto): ${fmt(r.utilidadTotalReconocida)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
