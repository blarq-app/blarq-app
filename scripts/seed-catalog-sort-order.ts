/**
 * Seedea sortOrder en PartidaCatalog usando el orden alfabético actual
 * dentro de cada categoría — preserva el orden visual de hoy.
 *
 * Run: npx tsx scripts/seed-catalog-sort-order.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const partidas = await prisma.partidaCatalog.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      category: true,
      name: true,
      sortOrder: true,
      descriptionCliente: true,
    },
  });

  // Verificar que el rename sobrevivió
  const withDesc = partidas.filter(
    (p) => p.descriptionCliente && p.descriptionCliente.trim() !== ""
  );
  console.log(`Total partidas: ${partidas.length}`);
  console.log(`Con descriptionCliente: ${withDesc.length}\n`);

  // Asignar sortOrder por categoría
  let updated = 0;
  let lastCategory = "";
  let positionInCategory = 0;
  for (const p of partidas) {
    if (p.category !== lastCategory) {
      lastCategory = p.category;
      positionInCategory = 0;
    }
    if (p.sortOrder !== positionInCategory) {
      await prisma.partidaCatalog.update({
        where: { id: p.id },
        data: { sortOrder: positionInCategory },
      });
      updated++;
    }
    positionInCategory++;
  }

  console.log(`✓ ${updated} partidas con sortOrder asignado`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
