/**
 * El punto de todo el cambio del 2026-08-02: una línea con el descuento puesto
 * por MJ tiene que SEGUIR recibiendo los precios de la tienda.
 *
 * Antes esto era imposible: mover el descuento despegaba la línea, así que esa
 * cotización se congelaba y nunca más se enteraba de que el precio cambió.
 *
 * Corre contra la base DEV. Crea todo lo que necesita y lo borra al final.
 *
 *   npx tsx scripts/test-descuento-propio.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { propagateCatalogToBorradores } from "../src/lib/catalog/syncArtefactos";

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
let ok = 0;
let fail = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else fail++;
  console.log(`  ${cond ? "OK  " : "FALL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log("Base:", url.match(/@([^/]+)/)?.[1]);
  if (!/solitary-mud/.test(url)) throw new Error("Solo contra dev. Abortado.");

  const proyecto = await prisma.project.create({
    data: { name: "__TEST_DCTO_PROPIO__", clientName: "__TEST__", status: "cotizacion" },
  });
  const cat = await prisma.artefactoCatalog.create({
    data: { name: "GRIFERÍA TEST", subcategory: "sanitario", listPrice: 100000, discountPercent: 0.2 },
  });
  const bv = await prisma.budgetVersion.create({
    data: { projectId: proyecto.id, version: "V1", type: "artefactos", status: "borrador" },
  });

  // Dos líneas del mismo producto: una sigue a la tienda, la otra tiene el
  // descuento de MJ (45% donde la tienda da 20%).
  const deTienda = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: bv.id, room: "bano", subcategory: "sanitario", name: "GRIFERÍA TEST",
      quantity: 1, listPrice: 100000, discountPercent: 0.2, clientPrice: 80000,
      catalogId: cat.id, priceOverridden: false, discountOverridden: false,
    },
  });
  const propia = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: bv.id, room: "bano_2", subcategory: "sanitario", name: "GRIFERÍA TEST",
      quantity: 1, listPrice: 100000, discountPercent: 0.45, clientPrice: 55000,
      catalogId: cat.id, priceOverridden: false, discountOverridden: true,
    },
  });

  try {
    console.log("\nLa tienda sube la lista de $100.000 a $130.000 y baja su dcto a 10%:");
    await prisma.artefactoCatalog.update({
      where: { id: cat.id },
      data: { listPrice: 130000, discountPercent: 0.1 },
    });
    const n = await propagateCatalogToBorradores(cat.id, {
      name: "GRIFERÍA TEST", detail: null, brand: null,
      listPrice: 130000, discountPercent: 0.1, referenceLink: null, imageUrl: null,
    });
    check("la propagación alcanzó a las DOS líneas", n === 2, `alcanzó ${n}`);

    const a = await prisma.artefactoItem.findUnique({ where: { id: deTienda.id } });
    const b = await prisma.artefactoItem.findUnique({ where: { id: propia.id } });

    console.log("\n  Línea que sigue a la tienda:");
    check("toma la lista nueva", a?.listPrice === 130000, CLP(a?.listPrice ?? 0));
    check("toma el descuento nuevo de la tienda", Math.abs((a?.discountPercent ?? 0) - 0.1) < 0.001);
    check("precio al cliente = 130.000 − 10%", Math.abs((a?.clientPrice ?? 0) - 117000) < 1, CLP(a?.clientPrice ?? 0));

    console.log("\n  Línea con el descuento de MJ (lo que antes era imposible):");
    check("TAMBIÉN toma la lista nueva", b?.listPrice === 130000, CLP(b?.listPrice ?? 0));
    check("CONSERVA el 45% de MJ", Math.abs((b?.discountPercent ?? 0) - 0.45) < 0.001, `${((b?.discountPercent ?? 0) * 100).toFixed(0)}%`);
    check("precio al cliente = 130.000 − 45%", Math.abs((b?.clientPrice ?? 0) - 71500) < 1, CLP(b?.clientPrice ?? 0));
    check("sigue SIN estar despegada", b?.priceOverridden === false);

    console.log("\n  Antes del cambio, esa línea se habría quedado en $55.000 para siempre.");
  } finally {
    await prisma.artefactoItem.deleteMany({ where: { budgetVersionId: bv.id } });
    await prisma.budgetVersion.delete({ where: { id: bv.id } });
    await prisma.artefactoCatalog.delete({ where: { id: cat.id } });
    await prisma.project.delete({ where: { id: proyecto.id } });
    console.log("\nDatos de prueba borrados.");
    await prisma.$disconnect();
  }
  console.log(`\nRESULTADO: ${ok} OK, ${fail} FALL`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
