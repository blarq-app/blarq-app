import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const EXCEL_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/1- COTIZACIONES/2026/157_CRISTIAN LEFEVRE/1- Presupuesto/V4/V4_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx";

// Map CONCEPTO values to our type system
const CONCEPTO_MAP: Record<string, string> = {
  MATERIAL: "material",
  "MANO OBRA": "mano_obra",
  MARGEN: "margen",
  HERRAMIENTAS: "herramientas",
  HERRAMIENTA: "herramientas",
  SUBCONTRATO: "subcontrato",
  PERDIDA: "perdida",
};

async function importPartidas() {
  console.log("Leyendo Excel...");
  const workbook = XLSX.readFile(EXCEL_PATH);

  // ===== IMPORT MATERIALES =====
  console.log("\n--- Importando Materiales ---");
  const matSheet = workbook.Sheets["MATERIALES"];
  const matData = XLSX.utils.sheet_to_json<any>(matSheet, { header: 1 });

  let matCount = 0;
  for (let i = 1; i < matData.length; i++) {
    const row = matData[i];
    const category = row[0]?.toString()?.trim();
    const name = row[1]?.toString()?.trim();
    const price = parseFloat(row[2]) || 0;
    const link = row[3]?.toString()?.trim() || null;

    if (!name) continue;

    await prisma.materialCatalog.upsert({
      where: { name },
      update: { netPrice: price, referenceLink: link, category: category || "GENERAL" },
      create: {
        name,
        category: category || "GENERAL",
        unit: "UN",
        netPrice: price,
        referenceLink: link,
      },
    });
    matCount++;
  }
  console.log(`  ${matCount} materiales importados`);

  // ===== IMPORT PARTIDAS =====
  console.log("\n--- Importando Partidas ---");
  const bdSheet = workbook.Sheets["BASE DATOS"];
  const bdData = XLSX.utils.sheet_to_json<any>(bdSheet, { header: 1 });

  // Group rows by (category, partida name)
  const partidasMap = new Map<
    string,
    {
      category: string;
      name: string;
      unit: string;
      components: {
        type: string;
        description: string;
        unit: string;
        quantity: number;
        unitCost: number;
        totalCost: number;
        link: string | null;
      }[];
    }
  >();

  for (let i = 1; i < bdData.length; i++) {
    const row = bdData[i];
    const category = row[0]?.toString()?.trim();
    const partidaName = row[1]?.toString()?.trim();
    const partidaUnit = row[2]?.toString()?.trim();
    const concepto = row[4]?.toString()?.trim();
    const detalle = row[5]?.toString()?.trim();
    const conceptoUnit = row[7]?.toString()?.trim() || "UN";
    const quantity = parseFloat(row[8]) || 0;
    const unitCost = parseFloat(row[9]) || 0;
    const totalCost = parseFloat(row[10]) || 0;
    const link = row[12]?.toString()?.trim() || null;

    if (!category || !partidaName || !concepto) continue;

    const key = `${category}|||${partidaName}`;

    if (!partidasMap.has(key)) {
      partidasMap.set(key, {
        category,
        name: partidaName,
        unit: partidaUnit || "GL",
        components: [],
      });
    }

    const type = CONCEPTO_MAP[concepto] || "material";

    partidasMap.get(key)!.components.push({
      type,
      description: detalle || concepto,
      unit: conceptoUnit,
      quantity,
      unitCost,
      totalCost,
      link,
    });
  }

  let partidaCount = 0;
  for (const [, partida] of partidasMap) {
    // Calculate cost breakdown
    const costMaterial = partida.components
      .filter((c) => c.type === "material")
      .reduce((sum, c) => sum + c.totalCost, 0);
    const costLabor = partida.components
      .filter((c) => c.type === "mano_obra")
      .reduce((sum, c) => sum + c.totalCost, 0);
    const costTools = partida.components
      .filter((c) => c.type === "herramientas")
      .reduce((sum, c) => sum + c.totalCost, 0);
    const costMargin = partida.components
      .filter((c) => c.type === "margen")
      .reduce((sum, c) => sum + c.totalCost, 0);
    const costLoss = partida.components
      .filter((c) => c.type === "perdida")
      .reduce((sum, c) => sum + c.totalCost, 0);
    const costSubcontract = partida.components
      .filter((c) => c.type === "subcontrato")
      .reduce((sum, c) => sum + c.totalCost, 0);

    const unitPrice =
      costMaterial + costLabor + costTools + costMargin + costLoss + costSubcontract;

    // Upsert partida
    const created = await prisma.partidaCatalog.upsert({
      where: {
        category_name: { category: partida.category, name: partida.name },
      },
      update: {
        unit: partida.unit,
        unitPrice,
        costMaterial,
        costLabor,
        costTools,
        costMargin,
        costLoss,
        costSubcontract,
      },
      create: {
        category: partida.category,
        name: partida.name,
        unit: partida.unit,
        unitPrice,
        costMaterial,
        costLabor,
        costTools,
        costMargin,
        costLoss,
        costSubcontract,
      },
    });

    // Delete existing components and re-create
    await prisma.partidaComponent.deleteMany({
      where: { partidaId: created.id },
    });

    for (let idx = 0; idx < partida.components.length; idx++) {
      const comp = partida.components[idx];

      // Try to find matching material
      let materialId: string | null = null;
      if (comp.type === "material" && comp.description) {
        const mat = await prisma.materialCatalog.findFirst({
          where: { name: comp.description },
        });
        if (mat) materialId = mat.id;
      }

      await prisma.partidaComponent.create({
        data: {
          partidaId: created.id,
          type: comp.type,
          description: comp.description,
          unit: comp.unit,
          quantity: comp.quantity,
          unitCost: comp.unitCost,
          totalCost: comp.totalCost,
          referenceLink: comp.link,
          materialId,
          sortOrder: idx,
        },
      });
    }

    partidaCount++;
  }

  console.log(`  ${partidaCount} partidas importadas con sus componentes`);
  console.log("\n✅ Importación completada!");
}

importPartidas()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
