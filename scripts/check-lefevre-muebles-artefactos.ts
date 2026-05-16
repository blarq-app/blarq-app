import "dotenv/config";
import { prisma } from "../src/lib/prisma";

(async () => {
  const p = await prisma.project.findFirst({
    where: { name: { contains: "JNC", mode: "insensitive" } },
  });
  if (!p) return console.log("no project");
  const budgets = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: { in: ["muebles", "artefactos"] } },
    include: {
      muebleChapters: { include: { items: true } },
      artefactoItems: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${p.name} · ${budgets.length} presupuestos muebles/artefactos:`);
  for (const b of budgets) {
    if (b.type === "muebles") {
      const chapters = b.muebleChapters.length;
      const items = b.muebleChapters.reduce((s, c) => s + c.items.length, 0);
      const total = b.muebleChapters
        .flatMap((c) => c.items)
        .reduce((s, it) => s + (it.clientPriceIva ?? 0) * it.quantity, 0);
      console.log(
        `  Muebles ${b.version} (${b.status}) · ${chapters} chapters · ${items} items · total c/IVA $${Math.round(total).toLocaleString("es-CL")}`
      );
    } else {
      const items = b.artefactoItems.length;
      const total = b.artefactoItems.reduce(
        (s, it) => s + (it.clientPrice ?? 0) * (it.quantity ?? 1),
        0
      );
      console.log(
        `  Artefactos ${b.version} (${b.status}) · ${items} items · total c/IVA $${Math.round(total).toLocaleString("es-CL")}`
      );
    }
  }
  await prisma.$disconnect();
})();
