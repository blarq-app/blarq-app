import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const names = ["Aguirre", "Lefevre", "Rosas", "Portofino", "Arrau", "Constanza", "Farellones"];
  for (const n of names) {
    const project = await prisma.project.findFirst({
      where: { name: { contains: n, mode: "insensitive" } },
    });
    if (!project) continue;
    const budgets = await prisma.budgetVersion.findMany({
      where: { projectId: project.id, type: "obra" },
      include: {
        obraItems: { include: { components: true } },
      },
    });
    for (const b of budgets) {
      const totalItems = b.obraItems.length;
      const itemsWithComps = b.obraItems.filter(
        (i) => i.components.length > 0
      ).length;
      let snapSum = 0;
      let compSum = 0;
      for (const it of b.obraItems) {
        const snap =
          (it.costMaterial ?? 0) +
          (it.costLabor ?? 0) +
          (it.costTools ?? 0) +
          (it.costSubcontract ?? 0) +
          (it.costLoss ?? 0) +
          (it.costMargin ?? 0);
        const cs = it.components.reduce((s, c) => s + (c.totalCost ?? 0), 0);
        snapSum += snap * it.quantity;
        compSum += cs * it.quantity;
      }
      console.log(
        `${project.name.padEnd(20)} · ${b.version.padEnd(20)} · ${b.status.padEnd(9)} · items=${String(totalItems).padStart(3)} (${String(itemsWithComps).padStart(3)} con comps) · snap=$${Math.round(snapSum).toLocaleString("es-CL").padStart(13)} · comps=$${Math.round(compSum).toLocaleString("es-CL").padStart(13)} · diff=${Math.round(compSum - snapSum).toLocaleString("es-CL").padStart(13)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
