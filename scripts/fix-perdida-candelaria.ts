import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * Materializa la PÉRDIDA fantasma de la partida "INSTALACION GUARDAPOLVO
 * PORCELANATO" en la cotización Cocina Candelaria / V1 (borrador). Igual que el
 * fix del catálogo: hoy la pérdida es monto suelto ($1.260,5) sin línea en el
 * desglose; agrega la línea "% sobre el porcelanato" (% derivado del monto, así
 * el total no se mueve), y recalcula el ítem.
 *
 * Solo aplica a BORRADOR (no tocar enviadas/aprobadas). Dry-run por defecto,
 * --apply para escribir. Idempotente. Con backup.
 */

const APPLY = process.argv.includes("--apply");
const ITEM_ID = "cmpol0hpr003ejq04un9ry6ve"; // Cocina Candelaria / V1
const NAME_GUARD = "GUARDAPOLVO PORCELANATO";

function host() {
  const m = (process.env.DATABASE_URL || "").match(/@([^/.]+)/);
  return m ? m[1] : "desconocido";
}
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  console.log(`Host: ${host()}  —  modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}\n`);

  const item = await prisma.obraItem.findUnique({
    where: { id: ITEM_ID },
    include: { budgetVersion: { select: { status: true, version: true, project: { select: { name: true } } } } },
  });
  if (!item) throw new Error("No se encontró el ObraItem");
  if (!item.name.toUpperCase().includes(NAME_GUARD)) {
    throw new Error(`Guardia de nombre falló: el ítem es "${item.name}"`);
  }
  if (item.budgetVersion.status !== "borrador") {
    throw new Error(`El ítem NO está en borrador (está ${item.budgetVersion.status}). Abortando por seguridad.`);
  }

  const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: ITEM_ID }, orderBy: { sortOrder: "asc" } });
  console.log(`${item.budgetVersion.project?.name} / ${item.budgetVersion.version} (${item.budgetVersion.status})`);
  console.log(`  ANTES → costLoss lump = ${r2(item.costLoss ?? 0)} | P.U. = ${r2(item.unitPrice ?? 0)} | líneas = ${comps.length}`);

  if (comps.some((c) => c.type === "perdida")) {
    console.log("\nYa hay línea de pérdida → nada que hacer (idempotente).");
    return;
  }
  if (!item.costLoss || item.costLoss <= 0) {
    console.log("\nNo hay costLoss lump > 0 → nada que materializar.");
    return;
  }
  const porcelanato =
    comps.find((c) => c.type === "material" && /PORCELANATO/i.test(c.description)) ??
    comps.filter((c) => c.type === "material").sort((a, b) => b.totalCost - a.totalCost)[0];
  if (!porcelanato) throw new Error("No se encontró el material porcelanato");

  const base = porcelanato.totalCost;
  const pct = base > 0 ? (item.costLoss / base) * 100 : 0;
  const lineaTotal = base * (pct / 100);
  const puComponentes = comps.reduce((s, c) => s + c.totalCost, 0);
  console.log(`\n  Material destino: "${porcelanato.description}" (total ${r2(base)})`);
  console.log(`  % derivado: ${r2(pct)}%  →  línea pérdida = ${r2(lineaTotal)}  (vs lump ${r2(item.costLoss)} → ${Math.abs(lineaTotal - item.costLoss) < 0.5 ? "OK" : "⚠ NO calza"})`);
  console.log(`  DESPUÉS (simulado) → P.U. = ${r2(puComponentes + lineaTotal)} (Δ ${r2(puComponentes + lineaTotal - (item.unitPrice ?? 0))})`);

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada. Para aplicar: --apply (con OK de MJ).");
    return;
  }

  const stamp = process.env.STAMP || "manual";
  const backupPath = `/Users/mjblanco/Desktop/blarq-app/backups/fix-perdida-candelaria-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ item, comps }, null, 2));
  console.log(`\nBackup: ${backupPath}`);

  await prisma.obraItemComponent.create({
    data: {
      obraItemId: ITEM_ID,
      type: "perdida",
      description: "Pérdida porcelanato",
      unit: "%",
      quantity: r2(pct),
      unitCost: 0,
      totalCost: lineaTotal,
      appliedToComponentId: porcelanato.id,
      sortOrder: comps.length,
      isCustomized: true,
    },
  });
  await recalcObraItemFromComponents(ITEM_ID);
  const post = await prisma.obraItem.findUniqueOrThrow({ where: { id: ITEM_ID } });
  console.log(`\nAPLICADO → costLoss = ${r2(post.costLoss ?? 0)} | P.U. = ${r2(post.unitPrice ?? 0)} | Δ P.U. = ${r2((post.unitPrice ?? 0) - (item.unitPrice ?? 0))}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
