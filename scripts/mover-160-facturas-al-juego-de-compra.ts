// Mueve las 12 facturas RECIBIDAS que estaban archivadas en el juego de
// categorías de COBRO al juego de COMPRA (pendiente 160). Destinos aprobados
// por MJ el 2026-08-14 sobre la tabla de diag-160-facturas-lado-equivocado.
//
// Por default NO escribe: hay que pasar --apply. Antes de escribir deja un
// respaldo con la categoría anterior de cada factura, para poder volver atrás.
//
// Uso:
//   npx tsx scripts/mover-160-facturas-al-juego-de-compra.ts .env.prod
//   npx tsx scripts/mover-160-facturas-al-juego-de-compra.ts .env.prod --apply
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const envPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Categorías del juego de COMPRA (appliesTo="recibida") en la base viva.
const COMPRA = {
  MUEBLES: "cmnwgessj000brtde0h0lp8pc",
  ARTEFACTOS: "cmnwgessl000irtde71iksgdc",
  ART_COCINA: "cmnwgessm000krtdedzra1shj",
};

// Destino por RUT de proveedor. Donde el proveedor no dejaba clara la
// subcategoría va al PADRE, para que MJ afine después (no se adivina).
const DESTINO: Record<string, string> = {
  "77690596-8": COMPRA.MUEBLES, // ICPROYECTOS
  "76911036-4": COMPRA.MUEBLES, // Christian Geoffroy
  "76159290-4": COMPRA.ART_COCINA, // Proyectos Ingeniería y Diseño
  "96999930-7": COMPRA.ART_COCINA, // Kitchen Center
  "18478845-4": COMPRA.ARTEFACTOS, // Asael de la O
};

async function main() {
  console.log(`# BASE: ${host} — modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN"}\n`);

  const cats = await prisma.costCategory.findMany({
    select: { id: true, name: true, parentId: true, appliesTo: true },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ruta = (id: string) =>
    byId.get(id)!.parentId
      ? `${byId.get(byId.get(id)!.parentId!)!.name} > ${byId.get(id)!.name}`
      : byId.get(id)!.name;
  const raizDe = (catId: string) => {
    const c = byId.get(catId)!;
    return c.parentId ? byId.get(c.parentId)! : c;
  };

  const recibidas = await prisma.invoice.findMany({
    where: { type: "recibida", categoryId: { not: null } },
    select: {
      id: true, folioNumber: true, rutIssuer: true, businessName: true,
      netAmount: true, categoryId: true, project: { select: { name: true } },
    },
  });
  const aMover = recibidas.filter((i) => raizDe(i.categoryId!).appliesTo === "emitida");

  console.log(`Facturas en el juego de cobro: ${aMover.length}`);
  if (aMover.length !== 12) {
    console.log("*** Se esperaban 12. Parar y revisar antes de escribir. ***");
    if (APPLY) process.exit(1);
  }

  const respaldo = aMover.map((i) => ({
    id: i.id,
    folio: i.folioNumber,
    proveedor: i.businessName,
    categoryIdAnterior: i.categoryId,
    categoriaAnterior: ruta(i.categoryId!),
    categoryIdNuevo: DESTINO[i.rutIssuer ?? ""] ?? null,
  }));

  for (const r of respaldo) {
    if (!r.categoryIdNuevo) {
      console.log(`*** SIN DESTINO: F-${r.folio} ${r.proveedor} — parar. ***`);
      if (APPLY) process.exit(1);
      continue;
    }
    const inv = aMover.find((i) => i.id === r.id)!;
    console.log(
      `  F-${(r.folio ?? "?").padEnd(9)} ${(r.proveedor ?? "").slice(0, 28).padEnd(28)} ${clp(inv.netAmount).padStart(12)}  ${r.categoriaAnterior} → ${ruta(r.categoryIdNuevo)}`
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no se escribió nada. Correr con --apply para aplicar.");
    return;
  }

  const archivo = `backup-160-categorias-facturas.json`;
  writeFileSync(archivo, JSON.stringify(respaldo, null, 2));
  console.log(`\nRespaldo escrito en ${archivo} (tiene la categoría anterior de cada una).`);

  let n = 0;
  for (const r of respaldo) {
    await prisma.invoice.update({
      where: { id: r.id },
      data: { categoryId: r.categoryIdNuevo! },
    });
    n++;
  }
  console.log(`Listo: ${n} facturas movidas.`);

  // Verificación: no debe quedar ninguna recibida en el juego de cobro.
  const quedan = (
    await prisma.invoice.findMany({
      where: { type: "recibida", categoryId: { not: null } },
      select: { categoryId: true },
    })
  ).filter((i) => raizDe(i.categoryId!).appliesTo === "emitida").length;
  console.log(`Recibidas que siguen en el juego de cobro: ${quedan} (debe ser 0).`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
