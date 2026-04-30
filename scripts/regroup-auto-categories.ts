// Reagrupa las 3 categorías top "Auto - X" bajo un único top "Auto":
//   - Crea categoría top "Auto"
//   - Crea subs "Combustible", "Autopistas", "Seguro" bajo Auto
//   - Reasigna las facturas que estaban en "Auto - X" a las nuevas subs
//   - Borra las 3 categorías top viejas
//
// Idempotente: si ya está hecho, no rompe nada.
//
// Uso: npx tsx scripts/regroup-auto-categories.ts [--apply]

import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

const MAPPING: Array<{ oldName: string; newSubName: string }> = [
  { oldName: "Auto - Combustible", newSubName: "Combustible" },
  { oldName: "Auto - Autopistas", newSubName: "Autopistas" },
  { oldName: "Auto - Seguro", newSubName: "Seguro" },
];

async function main() {
  console.log(APPLY ? "🚀 APPLY mode\n" : "🔍 DRY RUN mode\n");

  // 1) Crear (o reusar) top "Auto"
  let autoTop = await prisma.costCategory.findFirst({
    where: { name: "Auto", parentId: null },
  });
  if (!autoTop) {
    if (APPLY) {
      autoTop = await prisma.costCategory.create({
        data: { name: "Auto", sortOrder: 50 },
      });
      console.log(`✓ creada top "Auto"`);
    } else {
      console.log(`+ crearía top "Auto"`);
    }
  } else {
    console.log(`· top "Auto" ya existe`);
  }

  // 2) Para cada vieja "Auto - X" → crear sub bajo Auto y mover facturas
  for (const m of MAPPING) {
    const oldCat = await prisma.costCategory.findFirst({
      where: { name: m.oldName, parentId: null },
    });
    if (!oldCat) {
      console.log(`  · no existe vieja "${m.oldName}", skip`);
      continue;
    }

    let newSub = autoTop
      ? await prisma.costCategory.findFirst({
          where: { name: m.newSubName, parentId: autoTop.id },
        })
      : null;

    if (!newSub && APPLY && autoTop) {
      newSub = await prisma.costCategory.create({
        data: { name: m.newSubName, parentId: autoTop.id, sortOrder: 0 },
      });
      console.log(`  ✓ creada sub "Auto > ${m.newSubName}"`);
    } else if (!newSub) {
      console.log(`  + crearía sub "Auto > ${m.newSubName}"`);
    } else {
      console.log(`  · sub "Auto > ${m.newSubName}" ya existe`);
    }

    // Reasignar facturas
    const count = await prisma.invoice.count({
      where: { categoryId: oldCat.id },
    });
    console.log(`    → ${count} facturas en "${m.oldName}" pasarán a sub`);

    if (APPLY && newSub) {
      await prisma.invoice.updateMany({
        where: { categoryId: oldCat.id },
        data: { categoryId: newSub.id },
      });
      // Borrar la vieja top
      await prisma.costCategory.delete({ where: { id: oldCat.id } });
      console.log(`    ✓ "${m.oldName}" borrada`);
    }
  }

  console.log(`\n${APPLY ? "✓ Listo" : "(dry-run, nada modificado)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
