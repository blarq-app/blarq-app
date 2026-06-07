import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";

/**
 * Regresión del Paso 4: pérdida % sobre TODOS los materiales
 * (appliedToType="material", sin appliedToComponentId). La pérdida debe ser el
 * % de la SUMA de todas las líneas material, no de una sola.
 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

async function main() {
  if ((process.env.DATABASE_URL || "").includes("shy-morning")) throw new Error("ABORT: PROD");
  const project = await prisma.project.create({ data: { name: `TEST_PERDIDA_TODOS_${Date.now()}`, clientName: "t", status: "cotizacion" } });
  try {
    const bv = await prisma.budgetVersion.create({ data: { projectId: project.id, version: "V1", type: "obra", status: "borrador" } });
    const oi = await prisma.obraItem.create({ data: { budgetVersionId: bv.id, chapter: "x", itemNumber: "1.1", name: "Test", unit: "M2", quantity: 1, unitPrice: 0, total: 0 } });

    await prisma.obraItemComponent.create({ data: { obraItemId: oi.id, type: "material", description: "Porcelanato", unit: "M2", quantity: 1, unitCost: 5000, totalCost: 5000, sortOrder: 0 } });
    await prisma.obraItemComponent.create({ data: { obraItemId: oi.id, type: "material", description: "Adhesivo", unit: "UN", quantity: 2, unitCost: 1500, totalCost: 3000, sortOrder: 1 } });
    await prisma.obraItemComponent.create({ data: { obraItemId: oi.id, type: "mano_obra", description: "Maestro", unit: "M2", quantity: 1, unitCost: 4000, totalCost: 4000, sortOrder: 2 } });
    // Pérdida 10% sobre TODOS los materiales
    await prisma.obraItemComponent.create({ data: { obraItemId: oi.id, type: "perdida", description: "Pérdida", unit: "%", quantity: 10, unitCost: 0, totalCost: 0, appliedToType: "material", appliedToComponentId: null, sortOrder: 3 } });
    // Margen 15% (debe excluir la pérdida)
    await prisma.obraItemComponent.create({ data: { obraItemId: oi.id, type: "margen", description: "Margen", unit: "%", quantity: 15, unitCost: 0, totalCost: 0, sortOrder: 4 } });

    await recalcObraItemFromComponents(oi.id);
    const post = await prisma.obraItem.findUniqueOrThrow({ where: { id: oi.id } });

    console.log("Pérdida 10% sobre TODOS los materiales (5000 + 3000 = 8000):");
    assert(near(post.costMaterial ?? 0, 8000), `materiales = $8.000 (got ${post.costMaterial})`);
    assert(near(post.costLoss ?? 0, 800), `pérdida = $800 = 10% de (5000+3000), NO de uno solo (got ${post.costLoss})`);
    assert(near(post.costLabor ?? 0, 4000), `mano de obra = $4.000 (got ${post.costLabor})`);
    // margen 15% sobre material+MO (8000+4000=12000), excluye pérdida → 1800
    assert(near(post.costMargin ?? 0, 1800), `margen = $1.800 = 15% de (8000+4000), excluye pérdida (got ${post.costMargin})`);
    // unitPrice = 8000 + 4000 + 800 + 1800 = 14600
    assert(near(post.unitPrice ?? 0, 14600), `P.U. = $14.600 (got ${post.unitPrice})`);
    console.log("\nTODO OK.");
  } finally {
    await prisma.project.delete({ where: { id: project.id } });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
