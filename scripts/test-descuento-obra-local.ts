// Prueba de persistencia exclusivamente local; crea y elimina sus propios datos.
// DATABASE_URL=postgresql://postgres@127.0.0.1:5496/postgres node --import tsx scripts/test-descuento-obra-local.ts
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { buildBudgetSnapshot, restoreObraFromSnapshot } from "../src/lib/catalog/budgetSnapshot";

const host = new URL(process.env.DATABASE_URL ?? "postgresql://invalid").hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  throw new Error("Esta prueba requiere una base LOCAL, nunca Neon ni producción.");
}
async function main() {
  const project = await prisma.project.create({ data: { name: "Prueba local descuento", clientName: "Prueba" } });
  try {
    const budget = await prisma.budgetVersion.create({ data: {
      projectId: project.id, type: "obra", version: "V1", discountAmount: 10_000,
      ggPercentage: 0, utilityPercentage: 0,
      obraItems: { create: { chapter: "", itemNumber: "1.1", name: "Partida de prueba", unit: "GL",
        quantity: 1, unitPrice: 100_000, total: 100_000 } },
      paymentTerms: { create: { stage: "Cuota", percentage: 50, amount: 54_500 } },
    } });
    const photo = await buildBudgetSnapshot(budget.id);
    assert.equal(photo.discountAmount, 10_000);
    await prisma.budgetVersion.update({ where: { id: budget.id }, data: {
      sentSnapshot: JSON.parse(JSON.stringify(photo)), discountAmount: 20_000,
    } });
    await restoreObraFromSnapshot(budget.id);
    let restored = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: budget.id }, include: { paymentTerms: true } });
    assert.equal(restored.discountAmount, 10_000);
    assert.equal(restored.paymentTerms[0].amount, 54_500);
    const oldPhoto = JSON.parse(JSON.stringify(photo));
    delete oldPhoto.discountAmount;
    await prisma.budgetVersion.update({ where: { id: budget.id }, data: { sentSnapshot: oldPhoto } });
    await restoreObraFromSnapshot(budget.id);
    restored = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: budget.id }, include: { paymentTerms: true } });
    assert.equal(restored.discountAmount, 0);
    assert.equal(restored.paymentTerms[0].amount, 59_500);
    console.log("Fotos nuevas y antiguas: descuento y cuotas restaurados correctamente.");
  } finally { await prisma.project.delete({ where: { id: project.id } }); }
}
main().finally(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exitCode = 1; });
