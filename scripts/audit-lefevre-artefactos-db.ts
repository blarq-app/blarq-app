/**
 * Audit READ-ONLY del Artefactos V5 actual en la BD (apuntá DATABASE_URL
 * a prod via .env.prod).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

(async () => {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "JNC", mode: "insensitive" } },
  });
  if (!project) return console.log("no project");
  const budget = await prisma.budgetVersion.findFirst({
    where: { projectId: project.id, type: "artefactos", version: "V5" },
    include: { artefactoItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!budget) {
    console.log("no Artefactos V5 en prod");
    await prisma.$disconnect();
    return;
  }
  console.log(`Artefactos V5 (${budget.status}) · ${budget.artefactoItems.length} items`);
  const byGroup = new Map<string, { count: number; total: number }>();
  for (const it of budget.artefactoItems) {
    const key = `${it.subcategory.padEnd(11)} · ${it.room}`;
    const g = byGroup.get(key) ?? { count: 0, total: 0 };
    g.count += 1;
    g.total += it.clientPrice * it.quantity;
    byGroup.set(key, g);
  }
  let grand = 0;
  for (const [k, v] of Array.from(byGroup.entries()).sort()) {
    console.log(
      `  ${k.padEnd(40)} · ${String(v.count).padStart(3)} items · $${Math.round(v.total).toLocaleString("es-CL").padStart(12)}`
    );
    grand += v.total;
  }
  console.log(
    `  ${"TOTAL".padEnd(40)} · ${String(budget.artefactoItems.length).padStart(3)} items · $${Math.round(grand).toLocaleString("es-CL").padStart(12)}`
  );
  await prisma.$disconnect();
})();
