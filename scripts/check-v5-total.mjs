import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const b = await prisma.budgetVersion.findFirst({
  where: { version: "V5", project: { name: { contains: "Lefevre" } } },
  include: { obraItems: true },
});
const sum = b.obraItems.reduce((s, i) => s + i.total, 0);
console.log("items count:", b.obraItems.length);
console.log("sum of totals:", sum);
console.log("expected (excel): 24829891");
console.log("diff:", sum - 24829891);

// Inspect items with decimal totals
const nonInt = b.obraItems.filter(i => !Number.isInteger(i.total));
console.log("non-integer totals:", nonInt.length);

// Re-compute from unitPrice × quantity
const recomputed = b.obraItems.reduce((s, i) => s + Math.round(i.unitPrice * i.quantity), 0);
console.log("recomputed (round each):", recomputed);

await prisma.$disconnect();
