import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";

/**
 * Regresión de los conceptos en % en una partida de la cotización:
 *   - Leyes sociales = mano de obra con unit "%" sobre la mano de obra.
 *   - Margen = unit "%" sobre el costo directo (todo menos margen y pérdida).
 * Verifica que editar el número de % recalcula los totales.
 */

let projectId = "";
let itemId = "";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  const project = await prisma.project.create({
    data: { name: "__TEST porcentajes", clientName: "__TEST" },
  });
  projectId = project.id;
  const bv = await prisma.budgetVersion.create({
    data: { projectId, version: "V1", type: "obra", status: "borrador" },
  });
  const item = await prisma.obraItem.create({
    data: {
      budgetVersionId: bv.id,
      chapter: "terminaciones",
      itemNumber: "1.1",
      name: "__TEST partida %",
      unit: "M2",
      quantity: 1,
      unitPrice: 0,
      total: 0,
    },
  });
  itemId = item.id;

  // material $20.000 + mano de obra $10.000 + leyes 30% + margen 20%
  await prisma.obraItemComponent.createMany({
    data: [
      { obraItemId: itemId, type: "material", description: "Mat", unit: "UN", quantity: 1, unitCost: 20000, totalCost: 20000, sortOrder: 0 },
      { obraItemId: itemId, type: "mano_obra", description: "Pintor", unit: "ML", quantity: 1, unitCost: 10000, totalCost: 10000, sortOrder: 1 },
      { obraItemId: itemId, type: "mano_obra", description: "Leyes sociales", unit: "%", quantity: 30, unitCost: 0, totalCost: 0, appliedToType: "mano_obra", sortOrder: 2 },
      { obraItemId: itemId, type: "margen", description: "Margen", unit: "%", quantity: 20, unitCost: 0, totalCost: 0, sortOrder: 3 },
    ],
  });

  console.log("Test A — leyes 30% sobre MO, margen 20% sobre costo:");
  await recalcObraItemFromComponents(itemId);
  let r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  assert(r.costMaterial === 20000, "material $20.000");
  // MO = 10.000 + leyes (30% de 10.000 = 3.000) = 13.000
  assert(r.costLabor === 13000, "mano de obra (con leyes) $13.000 = 10.000 + 30%");
  // margen 20% de (20.000 + 13.000) = 20% de 33.000 = 6.600
  assert(r.costMargin === 6600, "margen $6.600 = 20% de (20.000+13.000)");
  assert(r.unitPrice === 39600, "P.U. $39.600 = 20.000+13.000+6.600");

  console.log("Test B — editar leyes a 40% recalcula todo:");
  const leyes = await prisma.obraItemComponent.findFirstOrThrow({
    where: { obraItemId: itemId, description: "Leyes sociales" },
  });
  await prisma.obraItemComponent.update({ where: { id: leyes.id }, data: { quantity: 40 } });
  await recalcObraItemFromComponents(itemId);
  r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  // leyes = 40% de 10.000 = 4.000 → MO 14.000
  assert(r.costLabor === 14000, "mano de obra $14.000 (leyes 40%)");
  // margen 20% de (20.000 + 14.000) = 6.800
  assert(r.costMargin === 6800, "margen recalculado $6.800 = 20% de 34.000");
  assert(r.unitPrice === 40800, "P.U. $40.800 = 20.000+14.000+6.800");

  console.log("\nTODO OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (itemId) await prisma.obraItemComponent.deleteMany({ where: { obraItemId: itemId } });
    if (projectId) {
      await prisma.obraItem.deleteMany({ where: { budgetVersion: { projectId } } });
      await prisma.budgetVersion.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.$disconnect();
  });
