/**
 * Fix puntual: re-importa los ArtefactoItem de Portofino V6 usando
 * `parseArtefactos.ts` (el parser correcto de lib/import).
 *
 * Motivo: el import original se hizo con `import-budget.ts`, cuyo parser
 * interno de artefactos tiene un bug de doble cuenta para items con
 * quantity > 1 — guardaba clientPrice como (precio × qty) en vez del
 * unitario. Caso concreto: las perchas (qty 2) de Portofino quedaron con
 * el doble de precio, inflando artefactos sanitarios en $43.801.
 *
 * Este script borra los ArtefactoItem de la V6 de artefactos y los
 * recrea desde el Excel con el parser bueno. NO toca obra ni muebles.
 *
 * Dry-run por defecto, --apply para escribir.
 */
import "dotenv/config";
import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import { parseArtefactos } from "../src/lib/import/parseArtefactos";

const ART =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/60_PORTOFINO 4208 (ANGELICA OVALLE)/5- PRESUPUESTO/V6/V6_ARTEFACTOS_PORTOFINO_26.02.26.xlsx";
const APPLY = process.argv.includes("--apply");

async function main() {
  const project = await prisma.project.findFirst({ where: { name: "Portofino" } });
  if (!project) throw new Error("Proyecto Portofino no encontrado");
  const budget = await prisma.budgetVersion.findFirst({
    where: { projectId: project.id, type: "artefactos", version: "V6" },
    include: { artefactoItems: true },
  });
  if (!budget) throw new Error("Artefactos V6 no encontrado");

  const buf = fs.readFileSync(ART);
  const parsed = parseArtefactos(buf);

  const sumActual = budget.artefactoItems.reduce(
    (s, it) => s + it.clientPrice * it.quantity,
    0
  );
  const sumNuevo = parsed.items.reduce(
    (s, it) => s + it.clientPrice * it.quantity,
    0
  );
  console.log(
    `Artefactos V6 Portofino:\n  Actual en BD: ${budget.artefactoItems.length} items · $${Math.round(sumActual).toLocaleString("es-CL")}\n  Re-import:    ${parsed.items.length} items · $${Math.round(sumNuevo).toLocaleString("es-CL")}`
  );
  if (parsed.warnings.length) {
    console.log("Warnings parser:");
    for (const w of parsed.warnings) console.log("  - " + w);
  }

  if (!APPLY) {
    console.log("\n(dry-run. Para escribir, correr con --apply)");
    await prisma.$disconnect();
    return;
  }

  await prisma.artefactoItem.deleteMany({
    where: { budgetVersionId: budget.id },
  });
  let sortOrder = 0;
  for (const it of parsed.items) {
    await prisma.artefactoItem.create({
      data: {
        budgetVersionId: budget.id,
        room: it.room,
        subcategory: it.subcategory,
        name: it.name,
        detail: it.detail,
        brand: it.brand,
        quantity: it.quantity,
        listPrice: it.listPrice,
        discountPercent: it.discountPercent,
        clientPrice: it.clientPrice,
        realCostBlarq: it.realCostBlarq,
        referenceLink: it.referenceLink,
        sortOrder: sortOrder++,
      },
    });
  }
  console.log(`\n  ${parsed.items.length} ArtefactoItem recreados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
