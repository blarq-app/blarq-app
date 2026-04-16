import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const FILE =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/1- COTIZACIONES/2026/157_CRISTIAN LEFEVRE/1- Presupuesto/V4/V4_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx";

const PROJECT_ID = "cmnx59uvq0000rty9ouec5i25";

const CHAPTER_MAP: Record<string, string> = {
  "1": "demoliciones",
  "2": "reparaciones",
  "3": "electricas",
  "4": "sanitarias",
  "5": "terminaciones",
  "6": "limpieza",
};

function parseNum(v: any): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "");
  if (s === "-" || s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const wb = XLSX.readFile(FILE);
  const sh = wb.Sheets["PRESUPUESTO"];
  const rows: any[][] = XLSX.utils.sheet_to_json(sh, {
    header: 1,
    raw: false,
    defval: "",
  });

  // Normalize: strip data starting at row 20
  const dataRows = rows.slice(20);

  let currentChapter: string | null = null;
  const items: Array<{
    chapter: string;
    itemNumber: string;
    name: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    costLabor: number;
  }> = [];

  for (const r of dataRows) {
    const item = String(r[2] || "").trim();
    const name = String(r[3] || "").trim();
    if (!item && !name) continue;

    // Chapter header: item is just a number "1","2",...
    if (/^\d+$/.test(item)) {
      currentChapter = CHAPTER_MAP[item] || null;
      continue;
    }

    // Item row: "1.1","1.2",etc
    if (/^\d+\.\d+$/.test(item) && currentChapter) {
      const unit = String(r[6] || "").trim();
      const qty = parseNum(r[7]);
      const pu = parseNum(r[8]);
      const puMO = parseNum(r[11]);
      if (!name) continue;
      items.push({
        chapter: currentChapter,
        itemNumber: item,
        name,
        description: String(r[5] || "").trim(),
        unit: unit || "GL",
        quantity: qty,
        unitPrice: pu,
        costLabor: puMO,
      });
    }

    // Stop at totals
    if (name === "COSTO DIRECTO") break;
  }

  console.log(`Parsed ${items.length} partidas.`);

  // Catalog match by normalized name
  const catalog = await prisma.partidaCatalog.findMany();
  const catByName = new Map<string, string>();
  for (const c of catalog) {
    catByName.set(c.name.trim().toLowerCase(), c.id);
  }

  // Create V4 budget
  const existing = await prisma.budgetVersion.findFirst({
    where: { projectId: PROJECT_ID, version: "V4", type: "obra" },
  });
  if (existing) {
    console.log("V4 ya existe, se eliminará para re-crear...");
    await prisma.budgetVersion.delete({ where: { id: existing.id } });
  }

  const budget = await prisma.budgetVersion.create({
    data: {
      projectId: PROJECT_ID,
      version: "V4",
      type: "obra",
      status: "borrador",
      ggPercentage: 20,
      utilityPercentage: 5,
      observations:
        "Importado desde V4_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx el " +
        new Date().toISOString().split("T")[0],
    },
  });

  let matched = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const catalogPartidaId =
      catByName.get(it.name.trim().toLowerCase()) || null;
    if (catalogPartidaId) matched++;

    await prisma.obraItem.create({
      data: {
        budgetVersionId: budget.id,
        chapter: it.chapter,
        itemNumber: it.itemNumber,
        name: it.name,
        description: it.description || null,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.quantity * it.unitPrice,
        costLabor: it.costLabor || null,
        catalogPartidaId,
        sortOrder: i,
      },
    });
  }

  // Payment terms
  await prisma.paymentTerm.createMany({
    data: [
      { budgetVersionId: budget.id, stage: "anticipo", percentage: 40, sortOrder: 0 },
      { budgetVersionId: budget.id, stage: "avance1", percentage: 25, sortOrder: 1 },
      { budgetVersionId: budget.id, stage: "avance2", percentage: 25, sortOrder: 2 },
      { budgetVersionId: budget.id, stage: "saldo", percentage: 10, sortOrder: 3 },
    ],
  });

  // Update project currentVersion, address, UF
  await prisma.project.update({
    where: { id: PROJECT_ID },
    data: { currentVersion: "V4", ufReference: 39722 },
  });

  console.log(`✓ Creado V4 con ${items.length} partidas.`);
  console.log(`✓ ${matched}/${items.length} matcheadas al catálogo.`);
  console.log(`Budget ID: ${budget.id}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
