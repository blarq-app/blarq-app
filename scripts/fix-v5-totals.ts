/**
 * Re-read Excel V5 col I (unitPrice) and col J (total) with precise Math.round
 * and update each V5 ObraItem in the DB to match Excel exactly.
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/fix-v5-totals.ts
 */

import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXCEL_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/1- COTIZACIONES/2026/157_CRISTIAN LEFEVRE/1- Presupuesto/V5/V5_ OBRA_CRISTIAN LEFEVRE_08.04.26.xlsx";

async function main() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets["PRESUPUESTO"];
  const rawData = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  // Build map of itemNumber → { unitPrice, total } from Excel
  const excelMap = new Map<string, { unitPrice: number; total: number }>();
  for (let r = 20; r <= 77; r++) {
    const row = rawData[r];
    if (!row) continue;
    const C = row[2];
    if (typeof C !== "string" || !/^\d+\.\d+$/.test(C)) continue;
    const I = row[8];
    const J = row[9];
    if (typeof I !== "number" || typeof J !== "number") continue;
    // Store RAW col J (with decimals) — display rounds per row, sum uses raw
    excelMap.set(C, { unitPrice: Math.round(I), total: J });
  }
  console.log(`Parsed ${excelMap.size} items from Excel`);

  const budget = await prisma.budgetVersion.findFirst({
    where: { version: "V5", project: { name: { contains: "Lefevre" } } },
    include: { obraItems: true },
  });
  if (!budget) throw new Error("V5 budget not found");

  let updated = 0;
  let mismatchedTotal = 0;
  let mismatchedUP = 0;

  for (const item of budget.obraItems) {
    const excel = excelMap.get(item.itemNumber);
    if (!excel) {
      console.log(`  [no-match] ${item.itemNumber} ${item.name}`);
      continue;
    }
    const changes: { unitPrice?: number; total?: number } = {};
    if (item.unitPrice !== excel.unitPrice) {
      changes.unitPrice = excel.unitPrice;
      mismatchedUP++;
    }
    if (item.total !== excel.total) {
      changes.total = excel.total;
      mismatchedTotal++;
      console.log(
        `  ${item.itemNumber} total: ${item.total} → ${excel.total} (diff ${
          excel.total - item.total
        })`
      );
    }
    if (Object.keys(changes).length > 0) {
      await prisma.obraItem.update({ where: { id: item.id }, data: changes });
      updated++;
    }
  }

  const after = await prisma.obraItem.findMany({
    where: { budgetVersionId: budget.id },
  });
  const newSum = after.reduce((s, i) => s + i.total, 0);

  console.log(`\n✓ Updated ${updated} items`);
  console.log(`  unitPrice mismatches: ${mismatchedUP}`);
  console.log(`  total mismatches: ${mismatchedTotal}`);
  console.log(`  new sum: ${newSum}`);
  console.log(`  expected: 24829891`);
  console.log(`  diff: ${newSum - 24829891}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
