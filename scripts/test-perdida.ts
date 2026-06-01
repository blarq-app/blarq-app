import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";

/**
 * Regresión de PÉRDIDA como % de un material concreto, replicando una partida
 * tipo "INSTALACION PAVIMENTO PORCELANATO": pérdida 10% sobre el adhesivo (no
 * sobre todos los materiales), + leyes sociales + margen.
 */

let projectId = "";
let itemId = "";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  const project = await prisma.project.create({
    data: { name: "__TEST perdida", clientName: "__TEST" },
  });
  projectId = project.id;
  const bv = await prisma.budgetVersion.create({
    data: { projectId, version: "V1", type: "obra", status: "borrador" },
  });
  const item = await prisma.obraItem.create({
    data: {
      budgetVersionId: bv.id, chapter: "terminaciones", itemNumber: "1.1",
      name: "INSTALACION PAVIMENTO PORCELANATO", unit: "M2",
      quantity: 1, unitPrice: 0, total: 0,
    },
  });
  itemId = item.id;

  // Adhesivo: 0,5 × $10.664 = $5.332
  const adhesivo = await prisma.obraItemComponent.create({
    data: { obraItemId: itemId, type: "material", description: "BEKRON DA SACO 25KG", unit: "UN", quantity: 0.5, unitCost: 10664, totalCost: 5332, sortOrder: 0 },
  });
  // Nivelador: 0,1 × $3.361 = $336,1
  await prisma.obraItemComponent.create({
    data: { obraItemId: itemId, type: "material", description: "NIVELADOR", unit: "UN", quantity: 0.1, unitCost: 3361, totalCost: 336.1, sortOrder: 1 },
  });
  // Pérdida 10% SOBRE EL ADHESIVO (no sobre el nivelador)
  await prisma.obraItemComponent.create({
    data: { obraItemId: itemId, type: "perdida", description: "PERDIDA DE MATERIAL", unit: "%", quantity: 10, unitCost: 0, totalCost: 0, appliedToComponentId: adhesivo.id, sortOrder: 2 },
  });
  // Mano de obra ceramista $13.000
  await prisma.obraItemComponent.create({
    data: { obraItemId: itemId, type: "mano_obra", description: "CERAMISTA", unit: "M2", quantity: 1, unitCost: 13000, totalCost: 13000, sortOrder: 3 },
  });
  // Margen 15%
  await prisma.obraItemComponent.create({
    data: { obraItemId: itemId, type: "margen", description: "MARGEN", unit: "%", quantity: 15, unitCost: 0, totalCost: 0, sortOrder: 4 },
  });

  console.log("Test — pérdida 10% del adhesivo, leyes/margen:");
  await recalcObraItemFromComponents(itemId);
  let r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  // material = 5332 + 336.1 = 5668.1
  assert(Math.abs(r.costMaterial! - 5668.1) < 0.01, "material = $5.668,1 (adhesivo + nivelador)");
  // pérdida = 10% de 5332 (SOLO el adhesivo) = 533.2  — NO de 5668.1
  assert(Math.abs(r.costLoss! - 533.2) < 0.01, "pérdida = $533,2 (10% SOLO del adhesivo)");
  assert(r.costLabor === 13000, "mano de obra $13.000");
  // margen 15% de (material 5668.1 + pérdida? NO, margen excluye pérdida + MO 13000)
  // base = material(5668.1) + MO(13000) = 18668.1 → margen = 2800.215
  assert(Math.abs(r.costMargin! - 2800.215) < 0.01, "margen 15% de (material+MO), excluye pérdida = $2.800,2");

  console.log("Test — pérdida sin material elegido = $0 (no rompe):");
  const perdidaComp = await prisma.obraItemComponent.findFirstOrThrow({ where: { obraItemId: itemId, type: "perdida" } });
  await prisma.obraItemComponent.update({ where: { id: perdidaComp.id }, data: { appliedToComponentId: null } });
  await recalcObraItemFromComponents(itemId);
  r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  assert(r.costLoss === 0, "pérdida sin material apuntado = $0 (no explota)");

  console.log("\nTODO OK.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (itemId) await prisma.obraItemComponent.deleteMany({ where: { obraItemId: itemId } });
    if (projectId) {
      await prisma.obraItem.deleteMany({ where: { budgetVersion: { projectId } } });
      await prisma.budgetVersion.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.$disconnect();
  });
