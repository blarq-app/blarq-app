import "dotenv/config";
import { prisma } from "../src/lib/prisma";

(async () => {
  const p = await prisma.project.findFirst({
    where: { name: "Portofino" },
  });
  if (!p) return console.log("no project");

  console.log(`Portofino · ${p.id}\n`);
  const budgets = await prisma.budgetVersion.findMany({
    where: { projectId: p.id },
    include: {
      obraItems: { include: { components: true } },
      muebleChapters: { include: { items: { include: { details: true } } } },
      artefactoItems: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const b of budgets) {
    if (b.type === "obra") {
      const items = b.obraItems.length;
      const wc = b.obraItems.filter((i) => i.components.length > 0).length;
      const cd = b.obraItems.reduce(
        (s, it) =>
          s +
          ((it.costMaterial ?? 0) +
            (it.costLabor ?? 0) +
            (it.costTools ?? 0) +
            (it.costSubcontract ?? 0) +
            (it.costLoss ?? 0) +
            (it.costMargin ?? 0)) *
            it.quantity,
        0
      );
      console.log(
        `  Obra ${b.version} (${b.status}) · ${items} items · ${wc} con comps · CD snap=$${Math.round(cd).toLocaleString("es-CL")}`
      );
    }
    if (b.type === "muebles") {
      const chapters = b.muebleChapters.length;
      const items = b.muebleChapters.reduce((s, c) => s + c.items.length, 0);
      const details = b.muebleChapters.reduce(
        (s, c) => s + c.items.reduce((ss, it) => ss + it.details.length, 0),
        0
      );
      const total = b.muebleChapters
        .flatMap((c) => c.items)
        .reduce((s, it) => s + (it.clientPriceIva ?? 0) * it.quantity, 0);
      console.log(
        `  Muebles ${b.version} (${b.status}) · ${chapters} ch · ${items} items · ${details} detalles · total c/IVA=$${Math.round(total).toLocaleString("es-CL")}`
      );
    }
    if (b.type === "artefactos") {
      const byCat = new Map<string, { count: number; total: number }>();
      for (const it of b.artefactoItems) {
        const g = byCat.get(it.subcategory) ?? { count: 0, total: 0 };
        g.count += 1;
        g.total += it.clientPrice * it.quantity;
        byCat.set(it.subcategory, g);
      }
      const total = b.artefactoItems.reduce(
        (s, it) => s + it.clientPrice * it.quantity,
        0
      );
      console.log(
        `  Artefactos ${b.version} (${b.status}) · ${b.artefactoItems.length} items · total c/IVA=$${Math.round(total).toLocaleString("es-CL")}`
      );
      for (const [k, v] of byCat) {
        console.log(`      ${k}: ${v.count} items · $${Math.round(v.total).toLocaleString("es-CL")}`);
      }
    }
  }
  await prisma.$disconnect();
})();
