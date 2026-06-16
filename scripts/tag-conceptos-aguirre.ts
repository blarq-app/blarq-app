// Etiqueta el conceptoCobro de los cobros (facturas emitidas) de Francisco de
// Aguirre, según el Cuadro Resumen V7 que MJ entregó al cliente.
//
// Mapeo (del Excel "V7 Cuadro Resumen_CAMILA DECOMBE"):
//   125, 124, 137, 136, 155 → obra   (155 incluye una parte de Baño Visitas,
//                                      que es anexo de obra → va como obra)
//   135, 162                → muebles
//   131 (cocina), 132 (sanitarios), 156 (iluminación) → artefactos
//
// Por qué etiquetar TODO (no solo muebles/artefactos): un cobro con
// conceptoCobro=null se omite del Cuadro Resumen del cliente y cae en "obra"
// por default en la utilidad. Dejarlos explícitos arregla ambas vistas.
//
// DRY-RUN por defecto. Aplicar: npx tsx scripts/tag-conceptos-aguirre.ts --apply
// Apunta a .env.prod. Solo toca facturas EMITIDAS de Aguirre.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prodUrl = readFileSync(".env.prod", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  ?.replace(/^DATABASE_URL=/, "").replace(/^["']|["']$/g, "").trim();
if (!prodUrl?.includes("ep-shy-morning")) throw new Error("falta URL prod");
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

const FOLIO_CONCEPTO: Record<string, string> = {
  "125": "obra",
  "124": "obra",
  "137": "obra",
  "136": "obra",
  "155": "obra",
  "135": "muebles",
  "162": "muebles",
  "131": "artefactos",
  "132": "artefactos",
  "156": "artefactos",
};

async function main() {
  console.log(APPLY ? ">>> APLICAR (escribe en prod)" : ">>> DRY-RUN (no escribe)");
  console.log("=".repeat(60));

  const project = await prisma.project.findFirst({
    where: { name: { contains: "Aguirre" }, isInternal: false },
    select: { id: true, name: true },
  });
  if (!project) { console.log("No encontré Aguirre"); return; }

  const cobros = await prisma.invoice.findMany({
    where: { projectId: project.id, type: "emitida" },
    select: { id: true, folioNumber: true, conceptoCobro: true, totalAmount: true },
    orderBy: { issueDate: "asc" },
  });

  console.log(`${project.name} — ${cobros.length} cobros\n`);
  let cambios = 0;
  const sinMapeo: string[] = [];

  for (const c of cobros) {
    const target = c.folioNumber ? FOLIO_CONCEPTO[c.folioNumber] : undefined;
    const actual = c.conceptoCobro ?? "(null)";
    if (!target) {
      sinMapeo.push(c.folioNumber ?? "(sin folio)");
      console.log(`  ? folio ${(c.folioNumber ?? "—").padEnd(6)} ${actual.padEnd(12)} SIN MAPEO — no se toca`);
      continue;
    }
    const cambia = c.conceptoCobro !== target;
    console.log(
      `  ${cambia ? "→" : "·"} folio ${(c.folioNumber ?? "—").padEnd(6)} ${actual.padEnd(12)} ${cambia ? "→ " + target : "(ya está)"}`
    );
    if (cambia) {
      cambios++;
      if (APPLY) {
        await prisma.invoice.update({ where: { id: c.id }, data: { conceptoCobro: target } });
      }
    }
  }

  console.log(`\n${cambios} cobro(s) a etiquetar.` + (sinMapeo.length ? ` Sin mapeo: ${sinMapeo.join(", ")}` : ""));
  if (!APPLY) console.log("DRY-RUN: nada escrito. Aplicar: --apply");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
