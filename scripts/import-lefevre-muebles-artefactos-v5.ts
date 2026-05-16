/**
 * Import MUEBLES + ARTEFACTOS V5 (aprobado) de Cristian Lefevre desde los
 * Excel firmados con el cliente. Idempotente: borra los presupuestos
 * previos de muebles/artefactos del proyecto (V1 Muebles borrador que
 * existe en prod) y crea V5 aprobados nuevos.
 *
 * Dry-run por defecto, `--apply` para escribir.
 *
 * Muebles V5: 3 items hardcoded extraídos de la hoja "MUEBLES" (no hay
 * parser oficial). Artefactos V5: usa `parseArtefactos.ts` (el mismo
 * que usa el endpoint /api/proyectos/[id]/importar-artefactos).
 */
import "dotenv/config";
import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import { parseArtefactos } from "../src/lib/import/parseArtefactos";

const ARTEFACTOS_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/63_CRISTIAN LEFEVRE/1- Presupuesto/V5/V5_ARTEFACTOS_CRISTIAN LEFEVRE_10.04.26.xlsx";

const APPLY = process.argv.includes("--apply");

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "Lefevre", mode: "insensitive" } },
  });
  if (!project) throw new Error("Proyecto Lefevre no encontrado");
  console.log(`Proyecto: ${project.name} (id ${project.id})`);

  // ── 1. MUEBLES V5 ────────────────────────────────────────────────────────
  // Datos del Excel V5_MUEBLES (hoja "MUEBLES", fila 13-21):
  //   Chapter 1: MUEBLES DE COCINA
  //     1.1 MUEBLES — ROBERTO, MELAMINA, cd=5488460, util=0.36, neto=7464305, c/iva=8882524
  //         (5 detalles: cuerpo, trasera, frente base, frente mural, zócalo)
  //     1.2 HERRAJES — PROVELCAR, HERRAJES VARIOS, cd=182982, util=0.25, neto=228727, c/iva=272186
  //     1.3 CUBIERTAS — GIACOMO, CUARZO BLANCO NUBE, cd=1211166, util=0.25, neto=1513958, c/iva=1801610
  //   Total c/IVA: $10.956.319
  const muebles = [
    {
      itemNumber: "1.1",
      name: "MUEBLES",
      descriptionGeneral: "SEGÚN PLANOS ARQUITECTURA",
      supplier: "ROBERTO",
      costDistributor: 5488460,
      utilityPercentage: 0.36,
      clientPriceNet: 7464305.6,
      clientPriceIva: 8882523.664,
      quantity: 1,
      details: [
        { name: "CUERPO INTERIOR", material: "MELAMINA BLANCA 18MM, TAPACANTO PVC 0,4MM, TAPACANTO IDEM COLOR FRENTES" },
        { name: "TRASERA", material: "MELAMINA BLANCA 15MM" },
        { name: "FRENTE MUEBLE BASE", material: "MELAMINA MADERA CIPRÉS DORADO 18MM" },
        { name: "FRENTE MUEBLE MURAL", material: "MELAMINA ARCILLA VESTO" },
        { name: "ZOCALO", material: "TERCIADO MUEBLERIA REVESTIDO PORCELANATO EN OBRA" },
      ],
    },
    {
      itemNumber: "1.2",
      name: "HERRAJES",
      descriptionGeneral: "CORREDERA OCULTA CON FRENO BLUM, BISAGRAS, TIRADORES",
      supplier: "PROVELCAR",
      costDistributor: 182982,
      utilityPercentage: 0.25,
      clientPriceNet: 228727.5,
      clientPriceIva: 272185.725,
      quantity: 1,
      details: [],
    },
    {
      itemNumber: "1.3",
      name: "CUBIERTAS",
      descriptionGeneral: "CUARZO BLANCO NUBE",
      supplier: "GIACOMO",
      costDistributor: 1211166.4,
      utilityPercentage: 0.25,
      clientPriceNet: 1513958,
      clientPriceIva: 1801610.02,
      quantity: 1,
      details: [],
    },
  ];
  const muebleTotalIva = muebles.reduce(
    (s, m) => s + m.clientPriceIva * m.quantity,
    0
  );

  // ── 2. ARTEFACTOS V5 ─────────────────────────────────────────────────────
  if (!fs.existsSync(ARTEFACTOS_PATH))
    throw new Error("Excel de artefactos no encontrado: " + ARTEFACTOS_PATH);
  const buf = fs.readFileSync(ARTEFACTOS_PATH);
  const parsed = parseArtefactos(buf);
  const artefactosTotal = parsed.items.reduce(
    (s, it) => s + it.clientPrice * it.quantity,
    0
  );

  console.log(
    `\nMuebles V5: 1 chapter · 3 items · total c/IVA $${Math.round(muebleTotalIva).toLocaleString("es-CL")}`
  );
  console.log(
    `Artefactos V5: ${parsed.items.length} items · total c/IVA $${Math.round(artefactosTotal).toLocaleString("es-CL")}`
  );
  if (parsed.warnings.length > 0) {
    console.log("\nWARNINGS parser artefactos:");
    for (const w of parsed.warnings) console.log("  -", w);
  }

  // Sample primeros 6 artefactos
  console.log("\nSample artefactos (primeros 6):");
  for (const it of parsed.items.slice(0, 6)) {
    console.log(
      `  ${it.subcategory.padEnd(11)} ${it.room.padEnd(17)} ${it.name.slice(0, 25).padEnd(25)} ${it.brand?.slice(0, 12).padEnd(12) ?? "—".padEnd(12)} qty=${it.quantity} list=$${Math.round(it.listPrice).toLocaleString("es-CL")} cp=$${Math.round(it.clientPrice).toLocaleString("es-CL")}`
    );
  }

  if (!APPLY) {
    console.log("\n(dry-run. Para escribir, correr con --apply)");
    await prisma.$disconnect();
    return;
  }

  // ── 3. APLICAR — limpia previos + crea nuevos ───────────────────────────
  console.log("\n--- APLICANDO ---");
  const prev = await prisma.budgetVersion.deleteMany({
    where: { projectId: project.id, type: { in: ["muebles", "artefactos"] } },
  });
  console.log(`  Borrados previos: ${prev.count}`);

  // Muebles
  const muebleBudget = await prisma.budgetVersion.create({
    data: {
      projectId: project.id,
      version: "V5",
      type: "muebles",
      status: "aprobado",
    },
  });
  const chapter1 = await prisma.muebleChapter.create({
    data: {
      budgetVersionId: muebleBudget.id,
      chapterNumber: 1,
      name: "MUEBLES DE COCINA",
      sortOrder: 0,
    },
  });
  for (let i = 0; i < muebles.length; i++) {
    const m = muebles[i];
    const item = await prisma.muebleItem.create({
      data: {
        budgetVersionId: muebleBudget.id,
        chapterId: chapter1.id,
        itemNumber: m.itemNumber,
        name: m.name,
        descriptionGeneral: m.descriptionGeneral,
        quantity: m.quantity,
        supplier: m.supplier,
        costDistributor: m.costDistributor,
        utilityPercentage: m.utilityPercentage,
        clientPriceNet: m.clientPriceNet,
        clientPriceIva: m.clientPriceIva,
        sortOrder: i,
      },
    });
    for (let j = 0; j < m.details.length; j++) {
      await prisma.muebleDetail.create({
        data: { itemId: item.id, ...m.details[j], sortOrder: j },
      });
    }
  }
  console.log(`  Muebles V5 creado: chapter 1 + ${muebles.length} items`);

  // Artefactos
  const artBudget = await prisma.budgetVersion.create({
    data: {
      projectId: project.id,
      version: "V5",
      type: "artefactos",
      status: "aprobado",
    },
  });
  let sortOrder = 0;
  for (const it of parsed.items) {
    await prisma.artefactoItem.create({
      data: {
        budgetVersionId: artBudget.id,
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
  console.log(`  Artefactos V5 creado: ${parsed.items.length} items`);
  console.log("\nListo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
