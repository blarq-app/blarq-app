/**
 * Import Excel V5 (Cristian Lefevre) as a new approved BudgetVersion.
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/import-lefevre-v5.ts
 *
 * Rules:
 * - Prices from the Excel go ONLY to ObraItems — catalog is NOT modified.
 * - costLabor = col L (MO unitPrice from Excel).
 * - Non-labor cost breakdown is derived proportionally from the matching catalog entry.
 * - If no catalog match: remaining non-labor goes entirely to costMaterial.
 * - New BudgetVersion is created as status="aprobado", which triggers project.currentVersion = V5.
 */

import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXCEL_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/1- COTIZACIONES/2026/157_CRISTIAN LEFEVRE/1- Presupuesto/V5/V5_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx";

const PROJECT_NAME = "Remodelacion Depto Cristian Lefevre";

// Chapter mapping: Excel integer → ObraEditor chapter key
const CHAPTER_MAP: Record<number, string> = {
  1: "demoliciones",
  2: "reparaciones",
  3: "electricas",
  4: "sanitarias",
  5: "terminaciones",
  6: "limpieza",
};

interface ExcelRow {
  itemNumber: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  laborUnitPrice: number;
  excelTotal: number; // col J: exact total from Excel (avoids rounding errors)
  chapter: string;
}

async function main() {
  // ── 1. Find project ──────────────────────────────────────────────────────────
  const project = await prisma.project.findFirst({
    where: { name: { contains: "Lefevre" } },
  });
  if (!project) throw new Error(`Project not found: ${PROJECT_NAME}`);
  console.log(`✓ Project: ${project.name} (${project.id})`);

  // ── 2. Determine next version number ─────────────────────────────────────────
  const existing = await prisma.budgetVersion.findMany({
    where: { projectId: project.id, type: "obra" },
    orderBy: { createdAt: "desc" },
  });
  const maxV = existing.reduce((max, b) => {
    const m = b.version.match(/^V(\d+)$/i);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const version = `V${maxV + 1}`;
  console.log(`✓ New version: ${version} (existing: ${existing.map((b) => b.version).join(", ")})`);

  // ── 3. Parse Excel ────────────────────────────────────────────────────────────
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets["PRESUPUESTO"];
  if (!ws) throw new Error("Sheet 'PRESUPUESTO' not found");

  // Read as array-of-arrays (0-indexed)
  const rawData = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const rows: ExcelRow[] = [];
  let currentChapter = "demoliciones";
  let chapterItemCounters: Record<string, number> = {};

  for (let r = 20; r <= 77; r++) {
    // rows 21-78 in 1-indexed, 20-77 in 0-indexed
    const row = rawData[r];
    if (!row) continue;

    const C = row[2]; // col C: chapter number (integer) or item number (string like "1.1")
    const D = row[3]; // col D: name
    const G = row[6]; // col G: unit
    const H = row[7]; // col H: quantity
    const I = row[8]; // col I: P.U neto
    const L = row[11]; // col L: MO P.U

    if (C === null) continue;

    // Chapter row: C is an integer
    if (typeof C === "number" && Number.isInteger(C)) {
      const chKey = CHAPTER_MAP[C];
      if (!chKey) {
        console.warn(`  Unknown chapter number: ${C}`);
        continue;
      }
      currentChapter = chKey;
      console.log(`  Chapter ${C}: ${D} → ${chKey}`);
      continue;
    }

    // Item row: C is a string like "1.1"
    if (typeof C === "string" && /^\d+\.\d+$/.test(C)) {
      const name = String(D || "").trim();
      if (!name) continue;

      const unit = String(G || "UN").trim().toUpperCase();
      const quantity = typeof H === "number" ? H : 0;
      const unitPrice = typeof I === "number" ? Math.round(I) : 0;
      const laborUnitPrice = typeof L === "number" ? Math.round(L) : 0;
      // Use col J (exact Excel total) rather than round(I)*H to match Excel precisely
      const excelTotal = typeof row[9] === "number" ? Math.round(row[9] as number) : null;

      if (unitPrice === 0 && quantity === 0) continue;

      rows.push({
        itemNumber: C,
        name,
        unit,
        quantity,
        unitPrice,
        laborUnitPrice,
        excelTotal: excelTotal ?? Math.round(unitPrice * quantity),
        chapter: currentChapter,
      });
    }
  }

  console.log(`✓ Parsed ${rows.length} items from Excel`);

  // ── 4. Load catalog for name matching ────────────────────────────────────────
  const catalogAll = await prisma.partidaCatalog.findMany({
    select: {
      id: true,
      name: true,
      unitPrice: true,
      costMaterial: true,
      costLabor: true,
      costTools: true,
      costMargin: true,
      costLoss: true,
      costSubcontract: true,
    },
  });

  // Build a simple lookup by normalized name
  const catalogMap = new Map<string, (typeof catalogAll)[0]>();
  for (const c of catalogAll) {
    catalogMap.set(c.name.trim().toUpperCase(), c);
  }

  console.log(`✓ Catalog loaded: ${catalogAll.length} partidas`);

  // ── 5. Create BudgetVersion ───────────────────────────────────────────────────
  const budgetVersion = await prisma.budgetVersion.create({
    data: {
      projectId: project.id,
      version,
      type: "obra",
      status: "aprobado",
      ggPercentage: 20,
      utilityPercentage: 5,
      observations:
        "Importado desde Excel V5 (08.04.26). Precios negociados con cliente. No modificar catálogo.",
    },
  });
  console.log(`✓ Created BudgetVersion: ${budgetVersion.id}`);

  // Also update project.currentVersion and status
  await prisma.project.update({
    where: { id: project.id },
    data: { currentVersion: version, status: "en_ejecucion" },
  });
  console.log(`✓ Updated project currentVersion = ${version}`);

  // ── 6. Create ObraItems ───────────────────────────────────────────────────────
  let matched = 0;
  let unmatched = 0;
  let sortOrder = 0;

  for (const row of rows) {
    sortOrder += 10;
    const nameKey = row.name.toUpperCase();
    const catalog = catalogMap.get(nameKey);

    // Compute cost breakdown
    const costLabor = row.laborUnitPrice; // drives EP — use Excel value directly
    const nonLaborBudget = Math.max(0, row.unitPrice - costLabor);

    let costMaterial = 0;
    let costTools = 0;
    let costMargin = 0;
    let costLoss = 0;
    let costSubcontract = 0;
    let catalogPartidaId: string | null = null;

    if (catalog && catalog.unitPrice > 0) {
      catalogPartidaId = catalog.id;
      const catalogNonLabor = Math.max(
        0,
        catalog.unitPrice - (catalog.costLabor ?? 0)
      );

      if (catalogNonLabor > 0) {
        // Scale each non-labor component proportionally
        const scale = nonLaborBudget / catalogNonLabor;
        costMaterial = Math.round((catalog.costMaterial ?? 0) * scale);
        costTools = Math.round((catalog.costTools ?? 0) * scale);
        costMargin = Math.round((catalog.costMargin ?? 0) * scale);
        costLoss = Math.round((catalog.costLoss ?? 0) * scale);
        costSubcontract = Math.round((catalog.costSubcontract ?? 0) * scale);

        // Absorb rounding error into costMaterial
        const sum =
          costMaterial +
          costTools +
          costMargin +
          costLoss +
          costSubcontract +
          costLabor;
        costMaterial += row.unitPrice - sum;
      } else {
        // Catalog has no non-labor: put all non-labor into material
        costMaterial = nonLaborBudget;
      }
      matched++;
    } else {
      // No catalog match: all non-labor goes to material
      costMaterial = nonLaborBudget;
      unmatched++;
      console.log(`  [UNMATCHED] "${row.name}"`);
    }

    const total = row.excelTotal; // use exact Excel total (col J)

    await prisma.obraItem.create({
      data: {
        budgetVersionId: budgetVersion.id,
        chapter: row.chapter,
        itemNumber: row.itemNumber,
        name: row.name,
        descriptionCliente: null,
        descriptionMaestro: null,
        unit: row.unit,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        total,
        costMaterial,
        costLabor,
        costTools,
        costMargin,
        costLoss,
        costSubcontract,
        catalogPartidaId,
        sortOrder,
      },
    });
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Version: ${version}`);
  console.log(`   Items created: ${rows.length}`);
  console.log(`   Catalog matched: ${matched}`);
  console.log(`   Unmatched (material only): ${unmatched}`);
  console.log(`\n   Open: /proyectos/${project.id}/presupuesto/${budgetVersion.id}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
