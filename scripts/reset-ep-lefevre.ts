/**
 * Limpia los EPs basura de Lefevre y crea EP #1 fresh desde V5.
 * Ambos EPs actuales son borrador sin pagos, no se pierde data real.
 *
 * Run: npx tsx scripts/reset-ep-lefevre.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "Lefevre" } },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Lefevre no encontrado");

  const eps = await prisma.estadoPago.findMany({
    where: { projectId: project.id },
  });
  console.log(`Eliminando ${eps.length} EPs existentes (todos borrador, sin pagos)…`);
  await prisma.estadoPago.deleteMany({ where: { projectId: project.id } });

  // Crear EP #1 fresh
  const budget = await prisma.budgetVersion.findFirst({
    where: { projectId: project.id, type: "obra", version: "V5" },
    include: { obraItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!budget) throw new Error("V5 no encontrado");

  const ep = await prisma.estadoPago.create({
    data: {
      projectId: project.id,
      budgetVersionId: budget.id,
      number: 1,
      items: {
        create: budget.obraItems.map((item, idx) => {
          const lpu = item.costLabor ?? 0;
          return {
            obraItemId: item.id,
            chapter: item.chapter,
            itemNumber: item.itemNumber,
            name: item.name,
            descriptionMaestro: item.descriptionMaestro,
            unit: item.unit,
            quantity: item.quantity,
            laborUnitPrice: lpu,
            laborTotal: lpu * item.quantity,
            quantityExecuted: 0,
            pctAccumulated: 0,
            sortOrder: item.sortOrder ?? idx,
          };
        }),
      },
    },
    include: { items: true },
  });
  console.log(`✓ EP #1 creado con ${ep.items.length} partidas, basado en V5`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
