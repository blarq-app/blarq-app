/**
 * Import MUEBLES + ARTEFACTOS Portofino V1.
 *
 * Run: npx tsx scripts/import-portofino-muebles-artefactos.ts
 *
 * Crea dos BudgetVersions nuevas:
 *  - type=muebles (1 capítulo COCINA con 3 items)
 *  - type=artefactos (sub-categorías iluminación + sanitario + cocina)
 *
 * Idempotente: si ya hay V1 muebles/artefactos para Portofino, las elimina
 * primero y recrea (para poder re-correr el script ajustando).
 */

import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MUEBLES_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/60_PORTOFINO 4208 (ANGELICA OVALLE)/5- PRESUPUESTO/V5/V4_MUEBLES - PORTOFINO_03.03.26.xls";

const ARTEFACTOS_PATH =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/60_PORTOFINO 4208 (ANGELICA OVALLE)/5- PRESUPUESTO/V5/V5_ARTEFACTOS_PORTOFINO_26.02.26.xlsx";

async function main() {
  // ── 1. Find project ───────────────────────────────────────────────────────
  const project = await prisma.project.findFirst({ where: { name: "Portofino" } });
  if (!project) throw new Error("Proyecto Portofino no encontrado");
  console.log(`✓ Proyecto: ${project.name} (Nº ${project.numeroProyecto})`);

  // ── 2. Limpiar versiones previas de muebles/artefactos (idempotente) ────
  await prisma.budgetVersion.deleteMany({
    where: { projectId: project.id, type: { in: ["muebles", "artefactos"] } },
  });
  console.log("✓ Limpieza previa OK");

  // ── 3. MUEBLES ───────────────────────────────────────────────────────────
  await importMuebles(project.id);

  // ── 4. ARTEFACTOS ────────────────────────────────────────────────────────
  await importArtefactos(project.id);

  console.log("\n✅ Import muebles + artefactos completo");
  await prisma.$disconnect();
}

async function importMuebles(projectId: string) {
  console.log("\n=== MUEBLES ===");
  const wb = XLSX.readFile(MUEBLES_PATH);
  const ws = wb.Sheets["MUEBLES"];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const budget = await prisma.budgetVersion.create({
    data: {
      projectId,
      version: "V1",
      type: "muebles",
      status: "aprobado",
      observations: "Importado desde V4_MUEBLES Portofino (03.03.26)",
    },
  });

  // Header en fila 14 (0-indexed). Datos filas 15-17.
  const chapter = await prisma.muebleChapter.create({
    data: {
      budgetVersionId: budget.id,
      chapterNumber: 1,
      name: "COCINA",
      sortOrder: 0,
    },
  });

  let itemNum = 1;
  for (let r = 15; r <= 17; r++) {
    const row = rows[r];
    if (!row) continue;
    const itemName = String(row[1] || "").trim(); // ITEM col B
    const supplier = String(row[2] || "").trim(); // PROVEEDOR col C
    const material = String(row[3] || "").trim(); // MATERIAL col D
    const costDistributor = typeof row[4] === "number" ? row[4] : 0; // E
    const utilityPct = typeof row[5] === "number" ? row[5] : 0; // F (decimal)
    const clientNet = typeof row[6] === "number" ? row[6] : 0; // G
    const clientIva = typeof row[7] === "number" ? row[7] : 0; // H

    if (!itemName || costDistributor === 0) continue;

    await prisma.muebleItem.create({
      data: {
        budgetVersionId: budget.id,
        chapterId: chapter.id,
        itemNumber: `1.${itemNum}`,
        name: itemName,
        descriptionGeneral: material || null,
        quantity: 1,
        supplier: supplier || null,
        costDistributor: Math.round(costDistributor),
        utilityPercentage: utilityPct,
        clientPriceNet: Math.round(clientNet),
        clientPriceIva: Math.round(clientIva),
        sortOrder: (itemNum - 1) * 10,
      },
    });
    console.log(`  ✓ 1.${itemNum} ${itemName} → ${supplier} | $${Math.round(clientIva).toLocaleString("es-CL")}`);
    itemNum++;
  }
}

async function importArtefactos(projectId: string) {
  console.log("\n=== ARTEFACTOS ===");
  const wb = XLSX.readFile(ARTEFACTOS_PATH);

  const budget = await prisma.budgetVersion.create({
    data: {
      projectId,
      version: "V1",
      type: "artefactos",
      status: "aprobado",
      observations: "Importado desde V5_ARTEFACTOS Portofino (26.02.26)",
    },
  });

  let totalItems = 0;
  let sortOrder = 0;

  // ── Iluminación ────────────────────────────────────────────────────────
  // Header fila 18 (0-idx), datos filas 19-24, total fila 25
  const wsIlum = wb.Sheets["ARTEFACTOS ILUMINACION CASA MUS"];
  const rowsIlum = XLSX.utils.sheet_to_json<(string | number | null)[]>(wsIlum, {
    header: 1,
    defval: null,
  });
  for (let r = 19; r <= 24; r++) {
    const row = rowsIlum[r];
    if (!row) continue;
    const ubicacion = String(row[2] || "").trim();
    const modelo = String(row[3] || "").trim();
    const marca = String(row[4] || "").trim();
    const cantidad = typeof row[5] === "number" ? row[5] : 0;
    const precioLista = typeof row[6] === "number" ? row[6] : 0;
    const descto = typeof row[7] === "number" ? row[7] : 0;
    const total = typeof row[8] === "number" ? row[8] : 0;
    const precioNetoBlarq = typeof row[11] === "number" ? row[11] : 0;

    if (!modelo || precioLista === 0) continue;

    await prisma.artefactoItem.create({
      data: {
        budgetVersionId: budget.id,
        room: roomKey(ubicacion),
        subcategory: "iluminacion",
        name: modelo,
        detail: ubicacion || null,
        brand: marca || null,
        quantity: cantidad,
        listPrice: precioLista,
        discountPercent: descto || null,
        clientPrice: total,
        realCostBlarq: precioNetoBlarq || null,
        referenceLink: typeof row[15] === "string" ? row[15] : null,
        sortOrder: sortOrder += 10,
      },
    });
    totalItems++;
  }
  console.log(`  Iluminación: ${totalItems} items`);

  // ── Sanitarios — 3 baños ──────────────────────────────────────────────
  // BAÑO 1: header 19 (0-idx), datos 20-28
  // BAÑO 2: header 33 (0-idx), datos 34-43
  // BAÑO 3: header 48 (0-idx), datos 49-56
  const wsSan = wb.Sheets["ARTEFACTOS SANITARIOS"];
  const rowsSan = XLSX.utils.sheet_to_json<(string | number | null)[]>(wsSan, {
    header: 1,
    defval: null,
  });
  // Para cada baño: header en fila X, datos en X+1..X+N, total después.
  // Los rangos son los rows con item real (sin header ni total).
  const baños = [
    { room: "baño_principal_1", from: 21, to: 29 }, // 9 items
    { room: "baño_2", from: 35, to: 44 },           // 10 items
    { room: "baño_3_servicio", from: 50, to: 57 },  // 8 items
  ];
  for (const b of baños) {
    let bañoCount = 0;
    for (let r = b.from; r <= b.to; r++) {
      const row = rowsSan[r];
      if (!row) continue;
      const item = String(row[2] || "").trim();
      const detalle = String(row[3] || "").trim();
      const marca = String(row[4] || "").trim();
      const cantidad = typeof row[5] === "number" ? row[5] : 0;
      const precioLista = typeof row[6] === "number" ? row[6] : 0;
      const descto = typeof row[7] === "number" ? row[7] : 0;
      const total = typeof row[8] === "number" ? row[8] : 0;
      const valorBlarqIva = typeof row[11] === "number" ? row[11] : 0;

      if (!item || precioLista === 0) continue;
      if (item.toUpperCase().startsWith("TOTAL")) continue;

      await prisma.artefactoItem.create({
        data: {
          budgetVersionId: budget.id,
          room: b.room,
          subcategory: "sanitario",
          name: item,
          detail: detalle || null,
          brand: marca || null,
          quantity: cantidad,
          listPrice: precioLista,
          discountPercent: descto || null,
          clientPrice: total,
          realCostBlarq: valorBlarqIva || null,
          sortOrder: sortOrder += 10,
        },
      });
      bañoCount++;
      totalItems++;
    }
    console.log(`  Sanitarios ${b.room}: ${bañoCount} items`);
  }

  // ── Teka cocina ───────────────────────────────────────────────────────
  // Header fila 18 (0-idx), datos 19-23, total 24
  const wsTeka = wb.Sheets["ARTEFACTOS TEKA COCINA"];
  const rowsTeka = XLSX.utils.sheet_to_json<(string | number | null)[]>(wsTeka, {
    header: 1,
    defval: null,
  });
  // Header fila 19 (0-idx), datos filas 20-24, total fila 25
  let tekaCount = 0;
  for (let r = 20; r <= 24; r++) {
    const row = rowsTeka[r];
    if (!row) continue;
    const item = String(row[2] || "").trim();
    const modelo = String(row[3] || "").trim();
    const marca = String(row[4] || "").trim();
    const cantidad = typeof row[5] === "number" ? row[5] : 0;
    const precioLista = typeof row[6] === "number" ? row[6] : 0;
    const descto = typeof row[7] === "number" ? row[7] : 0;
    const total = typeof row[8] === "number" ? row[8] : 0;
    const precioNetoBlarq = typeof row[11] === "number" ? row[11] : 0;

    if (!item || precioLista === 0) continue;
    if (item.toUpperCase().startsWith("TOTAL")) continue;

    await prisma.artefactoItem.create({
      data: {
        budgetVersionId: budget.id,
        room: "cocina",
        subcategory: "cocina",
        name: item,
        detail: modelo || null,
        brand: marca || null,
        quantity: cantidad,
        listPrice: precioLista,
        discountPercent: descto || null,
        clientPrice: total,
        realCostBlarq: precioNetoBlarq || null,
        sortOrder: sortOrder += 10,
      },
    });
    tekaCount++;
    totalItems++;
  }
  console.log(`  Teka Cocina: ${tekaCount} items`);
  console.log(`  TOTAL artefactos: ${totalItems} items`);
}

// Convierte la "ubicación" de iluminación (texto libre) a una room key normalizada.
// Para items que cubren múltiples espacios (ej "BAÑO 1, BAÑO 2, BAÑO VISITAS"),
// guardamos el detalle textual y dejamos el room como "varios".
function roomKey(ubicacion: string): string {
  const u = ubicacion.toLowerCase();
  if (u.includes(",") || u.split(" ").length > 4) return "varios";
  if (u.includes("baño principal")) return "baño_principal";
  if (u.includes("baño 2")) return "baño_2";
  if (u.includes("baño 3")) return "baño_3";
  if (u.includes("cocina")) return "cocina";
  if (u.includes("comedor")) return "comedor";
  if (u.includes("living")) return "living";
  if (u.includes("dorm")) return "dormitorio";
  if (u.includes("ampolleta")) return "varios";
  return "varios";
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
