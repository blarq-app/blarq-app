import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Crea datos DEMO en la base dev para verificar visualmente la propagación
 * de precios de artefactos. Imprime IDs y URLs. Limpiar con:
 *   npx tsx scripts/demo-artefactos-propagacion.ts --limpiar
 */
const NOMBRE_PROY = "__DEMO_ARTEFACTOS_PROP__";
const NOMBRE_CAT = "WC DEMO PROPAGACION";

async function limpiar() {
  await prisma.project.deleteMany({ where: { name: NOMBRE_PROY } });
  await prisma.artefactoCatalog.deleteMany({ where: { name: NOMBRE_CAT } });
  console.log("Demo limpiada.");
}

async function main() {
  if (process.argv.includes("--limpiar")) return limpiar();
  await limpiar(); // idempotente

  const cat = await prisma.artefactoCatalog.create({
    data: {
      name: NOMBRE_CAT, subcategory: "sanitario", line: "Demo",
      listPrice: 100000, discountPercent: 0, clientPrice: 100000,
      detail: "WC para demo de propagación",
    },
  });
  const proj = await prisma.project.create({
    data: { name: NOMBRE_PROY, clientName: "Demo", status: "cotizacion" },
  });
  const borrador = await prisma.budgetVersion.create({
    data: { projectId: proj.id, version: "V1", type: "artefactos", status: "borrador" },
  });
  // Línea que SIGUE al catálogo:
  await prisma.artefactoItem.create({
    data: {
      budgetVersionId: borrador.id, room: "bano_principal", subcategory: "sanitario",
      name: NOMBRE_CAT, detail: "WC para demo de propagación", quantity: 1,
      listPrice: 100000, discountPercent: 0, clientPrice: 100000,
      catalogId: cat.id, priceOverridden: false,
    },
  });
  // Línea DESPEGADA (editada a mano, con descuento):
  await prisma.artefactoItem.create({
    data: {
      budgetVersionId: borrador.id, room: "bano_secundario", subcategory: "sanitario",
      name: NOMBRE_CAT, detail: "WC para demo de propagación", quantity: 1,
      listPrice: 80000, discountPercent: 0.2, clientPrice: 80000,
      catalogId: cat.id, priceOverridden: true,
    },
  });
  // Versión ENVIADA (congelada):
  const enviada = await prisma.budgetVersion.create({
    data: {
      projectId: proj.id, version: "V2", type: "artefactos", status: "enviado",
      sentAt: new Date(),
    },
  });
  await prisma.artefactoItem.create({
    data: {
      budgetVersionId: enviada.id, room: "bano_principal", subcategory: "sanitario",
      name: NOMBRE_CAT, detail: "WC para demo de propagación", quantity: 1,
      listPrice: 100000, discountPercent: 0, clientPrice: 100000,
      catalogId: cat.id, priceOverridden: false,
    },
  });

  console.log("CAT_ID=" + cat.id);
  console.log("PROYECTO=" + proj.id);
  console.log("BORRADOR_URL=/proyectos/" + proj.id + "/presupuesto/" + borrador.id);
  console.log("ENVIADA_URL=/proyectos/" + proj.id + "/presupuesto/" + enviada.id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
