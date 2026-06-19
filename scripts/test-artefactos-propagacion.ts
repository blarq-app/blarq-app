import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  propagateCatalogToBorradores,
  editoCampoDeCatalogo,
} from "../src/lib/catalog/syncArtefactos";
import {
  buildBudgetSnapshot,
  restoreArtefactosFromSnapshot,
} from "../src/lib/catalog/budgetSnapshot";

/**
 * Test de integración del rediseño de precios de artefactos (2026-06-18).
 * Crea datos de prueba EN LA BASE DEV, ejerce la lógica real y limpia todo
 * al final. Cubre los 3 casos que pidió MJ + "volver a lo enviado".
 *
 * Uso: npx tsx scripts/test-artefactos-propagacion.ts
 */
let pasaron = 0;
let fallaron = 0;
function check(nombre: string, cond: boolean) {
  if (cond) {
    pasaron++;
    console.log(`  OK   ${nombre}`);
  } else {
    fallaron++;
    console.log(`  FALL ${nombre}`);
  }
}

async function main() {
  // ── Setup ────────────────────────────────────────────────────────────
  const proj = await prisma.project.create({
    data: {
      name: "__TEST_ARTEFACTOS_PROP__",
      clientName: "__TEST__",
      status: "cotizacion",
    },
  });
  const cat = await prisma.artefactoCatalog.create({
    data: {
      name: "WC TEST",
      subcategory: "sanitario",
      listPrice: 100000,
      discountPercent: 0,
      clientPrice: 100000,
    },
  });

  // Cotización BORRADOR con 2 líneas del mismo catálogo:
  //   A = sigue al catálogo (priceOverridden=false)
  //   B = despegada a mano (priceOverridden=true, precio con descuento)
  const borrador = await prisma.budgetVersion.create({
    data: { projectId: proj.id, version: "V1", type: "artefactos", status: "borrador" },
  });
  const A = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: borrador.id, room: "bano_principal", subcategory: "sanitario",
      name: "WC TEST", quantity: 1, listPrice: 100000, discountPercent: 0,
      clientPrice: 100000, catalogId: cat.id, priceOverridden: false,
    },
  });
  const B = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: borrador.id, room: "bano_secundario", subcategory: "sanitario",
      name: "WC TEST", quantity: 1, listPrice: 80000, discountPercent: 0.2,
      clientPrice: 80000, catalogId: cat.id, priceOverridden: true,
    },
  });

  // Cotización ENVIADA con 1 línea del mismo catálogo (debe quedar congelada).
  const enviada = await prisma.budgetVersion.create({
    data: {
      projectId: proj.id, version: "V2", type: "artefactos", status: "enviado",
      sentAt: new Date(),
    },
  });
  const C = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: enviada.id, room: "bano_principal", subcategory: "sanitario",
      name: "WC TEST", quantity: 1, listPrice: 100000, discountPercent: 0,
      clientPrice: 100000, catalogId: cat.id, priceOverridden: false,
    },
  });

  // ── Acción: sube el precio del catálogo y propaga ─────────────────────
  await prisma.artefactoCatalog.update({
    where: { id: cat.id }, data: { listPrice: 120000 },
  });
  const actualizadas = await propagateCatalogToBorradores(cat.id, {
    name: "WC TEST", detail: null, brand: null, listPrice: 120000,
    discountPercent: 0, referenceLink: null, imageUrl: null,
  });

  const A2 = await prisma.artefactoItem.findUnique({ where: { id: A.id } });
  const B2 = await prisma.artefactoItem.findUnique({ where: { id: B.id } });
  const C2 = await prisma.artefactoItem.findUnique({ where: { id: C.id } });

  console.log("CASO 1 — cambio en catálogo baja a borrador no tocado:");
  check("línea A (borrador, no despegada) se actualiza a 120000", A2?.listPrice === 120000);
  check("línea A clientPrice recalculado a 120000", A2?.clientPrice === 120000);
  console.log("CASO 2 — línea editada a mano NO se mueve:");
  check("línea B (despegada) sigue en 80000", B2?.listPrice === 80000);
  console.log("CASO 3 — cotización enviada queda congelada:");
  check("línea C (enviada) sigue en 100000", C2?.listPrice === 100000);
  check("propagación reportó exactamente 1 línea actualizada", actualizadas === 1);

  // ── Detección de "despegue" (función pura) ────────────────────────────
  console.log("DESPEGUE — qué edición despega la línea:");
  const prevBase = {
    priceOverridden: false, listPrice: 100000, discountPercent: 0,
    clientPrice: 100000, name: "WC TEST", detail: null, brand: null,
    referenceLink: null, imageUrl: null,
  };
  check(
    "cambiar solo cantidad NO despega (precio igual)",
    editoCampoDeCatalogo(prevBase, {
      listPrice: 100000, discountPercent: 0, clientPrice: 100000,
      name: "WC TEST", detail: null, brand: null, referenceLink: null, imageUrl: null,
    }) === false
  );
  check(
    "bajar el precio SÍ despega",
    editoCampoDeCatalogo(prevBase, {
      listPrice: 100000, discountPercent: 0.1, clientPrice: 90000,
      name: "WC TEST", detail: null, brand: null, referenceLink: null, imageUrl: null,
    }) === true
  );
  check(
    "cambiar el nombre SÍ despega",
    editoCampoDeCatalogo(prevBase, {
      listPrice: 100000, discountPercent: 0, clientPrice: 100000,
      name: "WC OTRO", detail: null, brand: null, referenceLink: null, imageUrl: null,
    }) === true
  );

  // ── Volver a lo enviado (artefactos) ──────────────────────────────────
  console.log("VOLVER A LO ENVIADO — restaura la foto:");
  // Foto de la enviada, luego se le edita una línea a mano, luego se restaura.
  const snap = await buildBudgetSnapshot(enviada.id);
  await prisma.budgetVersion.update({
    where: { id: enviada.id },
    data: { sentSnapshot: JSON.parse(JSON.stringify(snap)) },
  });
  await prisma.artefactoItem.update({
    where: { id: C.id }, data: { listPrice: 999999, clientPrice: 999999 },
  });
  const restore = await restoreArtefactosFromSnapshot(enviada.id);
  const itemsEnviadaPost = await prisma.artefactoItem.findMany({
    where: { budgetVersionId: enviada.id },
  });
  check("restauró la misma cantidad de líneas", restore.restoredItems === 1);
  check(
    "la línea volvió a 100000 (lo enviado)",
    itemsEnviadaPost.length === 1 && itemsEnviadaPost[0].listPrice === 100000
  );

  // ── Limpieza ──────────────────────────────────────────────────────────
  await prisma.project.delete({ where: { id: proj.id } }); // cascade → versiones + items
  await prisma.artefactoCatalog.delete({ where: { id: cat.id } });

  console.log("─".repeat(60));
  console.log(`RESULTADO: ${pasaron} OK, ${fallaron} FALL`);
  if (fallaron > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
