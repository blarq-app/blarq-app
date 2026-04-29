/**
 * Import OBRA Portofino V5 (Angelica Ovalle) como nueva BudgetVersion aprobada.
 *
 * Run: npx tsx scripts/import-portofino-v5.ts
 *
 * Estructura clonada de import-lefevre-v5.ts pero con ajustes específicos
 * para Portofino:
 *  - 8 capítulos en vez de 6 (suma "obra_gruesa" en cap 2 y "adicionales"
 *    en cap 8)
 *  - sub-numeración hasta 3 niveles (ej: 4.2.1) — Lefevre solo X.Y
 *  - utilityPercentage = 7 (vs 5 de Lefevre)
 *  - filas de datos hasta 85 (0-indexed) en vez de 77
 *
 * MUEBLES y ARTEFACTOS no se importan acá: tienen layout completamente
 * distinto y serán scripts aparte.
 */

import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXCEL_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/60_PORTOFINO 4208 (ANGELICA OVALLE)/5- PRESUPUESTO/V5/V5_ OBRA_PORTOFINO_24.03.26.xlsx";

const CHAPTER_MAP: Record<number, string> = {
  1: "demoliciones",
  2: "obra_gruesa",
  3: "reparaciones",
  4: "sanitarias",
  5: "electricas",
  6: "terminaciones",
  7: "limpieza",
  8: "adicionales",
};

interface ExcelRow {
  itemNumber: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  laborUnitPrice: number;
  excelTotal: number;
  chapter: string;
}

async function main() {
  // ── 1. Find project (creado vía import Maxxa, name limpio "Portofino") ───
  const project = await prisma.project.findFirst({
    where: { name: "Portofino" },
  });
  if (!project) throw new Error("Proyecto Portofino no encontrado en DB");
  console.log(`✓ Proyecto: ${project.name} (${project.id}, Nº ${project.numeroProyecto ?? "—"})`);

  // ── 2. Versión nueva ─────────────────────────────────────────────────────
  const existing = await prisma.budgetVersion.findMany({
    where: { projectId: project.id, type: "obra" },
    orderBy: { createdAt: "desc" },
  });
  const maxV = existing.reduce((max, b) => {
    const m = b.version.match(/^V(\d+)$/i);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const version = `V${maxV + 1}`;
  console.log(`✓ Versión nueva: ${version} (existentes: ${existing.map((b) => b.version).join(", ") || "ninguna"})`);

  // ── 3. Parse Excel ───────────────────────────────────────────────────────
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets["PRESUPUESTO"];
  if (!ws) throw new Error("Hoja 'PRESUPUESTO' no encontrada");

  const rawData = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const rows: ExcelRow[] = [];
  let currentChapter = "demoliciones";

  // Filas de datos: 21–86 (1-indexed) = 20–85 (0-indexed)
  for (let r = 20; r <= 85; r++) {
    const row = rawData[r];
    if (!row) continue;

    const C = row[2]; // ITEM
    const D = row[3]; // PARTIDA
    const G = row[6]; // UNIDAD
    const H = row[7]; // CANTIDAD
    const I = row[8]; // P.U
    const L = row[11]; // P.U (MO)

    if (C === null) continue;

    // Header de capítulo: C es entero
    if (typeof C === "number" && Number.isInteger(C)) {
      const chKey = CHAPTER_MAP[C];
      if (!chKey) {
        console.warn(`  ⚠ Capítulo desconocido: ${C}`);
        continue;
      }
      currentChapter = chKey;
      console.log(`  Cap ${C}: ${D} → ${chKey}`);
      continue;
    }

    // Item: C es string tipo "1.1" o "4.2.1" (3 niveles)
    if (typeof C === "string" && /^\d+\.\d+(\.\d+)?$/.test(C)) {
      const name = String(D || "").trim();
      if (!name) continue;

      const unit = String(G || "UN").trim().toUpperCase();
      const quantity = typeof H === "number" ? H : 0;
      const unitPrice = typeof I === "number" ? Math.round(I) : 0;
      const laborUnitPrice = typeof L === "number" ? Math.round(L) : 0;
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

  console.log(`✓ Parseadas ${rows.length} partidas del Excel`);

  // ── 4. Cargar catálogo para matching ─────────────────────────────────────
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
  const catalogMap = new Map<string, (typeof catalogAll)[0]>();
  for (const c of catalogAll) {
    catalogMap.set(c.name.trim().toUpperCase(), c);
  }
  console.log(`✓ Catálogo cargado: ${catalogAll.length} partidas`);

  // ── 5. Crear BudgetVersion ───────────────────────────────────────────────
  const budgetVersion = await prisma.budgetVersion.create({
    data: {
      projectId: project.id,
      version,
      type: "obra",
      status: "aprobado",
      ggPercentage: 20,
      utilityPercentage: 7,
      observations:
        "Importado desde Excel V5 OBRA Portofino (24.03.26). Precios negociados con cliente.",
    },
  });
  console.log(`✓ BudgetVersion creada: ${budgetVersion.id}`);

  // El proyecto ya está en estado "ejecucion" desde el import Maxxa.
  // Solo actualizo currentVersion para que refleje esta como la activa.
  await prisma.project.update({
    where: { id: project.id },
    data: { currentVersion: version },
  });
  console.log(`✓ project.currentVersion = ${version}`);

  // ── 6. Crear ObraItems ──────────────────────────────────────────────────
  let matched = 0;
  let unmatched = 0;
  let sortOrder = 0;

  for (const row of rows) {
    sortOrder += 10;
    const nameKey = row.name.toUpperCase();
    const catalog = catalogMap.get(nameKey);

    const costLabor = row.laborUnitPrice;
    const nonLaborBudget = Math.max(0, row.unitPrice - costLabor);

    let costMaterial = 0;
    let costTools = 0;
    let costMargin = 0;
    let costLoss = 0;
    let costSubcontract = 0;
    let catalogPartidaId: string | null = null;

    if (catalog && catalog.unitPrice > 0) {
      catalogPartidaId = catalog.id;
      const catalogNonLabor = Math.max(0, catalog.unitPrice - (catalog.costLabor ?? 0));

      if (catalogNonLabor > 0) {
        const scale = nonLaborBudget / catalogNonLabor;
        costMaterial = Math.round((catalog.costMaterial ?? 0) * scale);
        costTools = Math.round((catalog.costTools ?? 0) * scale);
        costMargin = Math.round((catalog.costMargin ?? 0) * scale);
        costLoss = Math.round((catalog.costLoss ?? 0) * scale);
        costSubcontract = Math.round((catalog.costSubcontract ?? 0) * scale);

        const sum = costMaterial + costTools + costMargin + costLoss + costSubcontract + costLabor;
        costMaterial += row.unitPrice - sum;
      } else {
        costMaterial = nonLaborBudget;
      }
      matched++;
    } else {
      costMaterial = nonLaborBudget;
      unmatched++;
      console.log(`  [SIN MATCH] "${row.name}"`);
    }

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
        total: row.excelTotal,
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

  console.log(`\n✅ Import OBRA Portofino completo`);
  console.log(`   Versión:           ${version}`);
  console.log(`   Items creados:     ${rows.length}`);
  console.log(`   Match catálogo:    ${matched}`);
  console.log(`   Sin match (mat):   ${unmatched}`);
  console.log(`\n   Abrir: /proyectos/${project.id}/presupuesto/${budgetVersion.id}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
