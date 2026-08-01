/**
 * Baja el precio de unos productos del catálogo a las cotizaciones en BORRADOR
 * que los usan — lo mismo que hace la app sola cuando se edita un producto
 * desde la pantalla del catálogo, pero para cambios hechos por script.
 *
 * Solo toca líneas NO despegadas y solo de cotizaciones en borrador (misma
 * regla que `propagateCatalogToBorradores`, ADR 2026-06-18). Las enviadas o
 * aprobadas quedan congeladas y las despegadas no se tocan.
 *
 * GOTCHA por el que la lógica está acá y no importada: `syncArtefactos.ts` usa
 * el `prisma` global de `src/lib/prisma.ts`, construido SIN datasource
 * explícito, así que lee el DATABASE_URL del `.env` — la base de DESARROLLO.
 * Importarlo desde un script que apunta a la viva actualiza el catálogo en la
 * viva y propaga en dev, devolviendo 0 líneas sin ningún error visible.
 *
 *   npx tsx scripts/propagar-catalogo-a-borradores.ts                  # dry-run
 *   npx tsx scripts/propagar-catalogo-a-borradores.ts --aplicar --si-la-viva
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Los productos que se limpiaron el 2026-08-01.
const NOMBRES = [
  "HORNO EMPOTRABLE 71 L",
  "PERCHA ATLAS SIMPLE LATÓN CROMADO 2.5X5.5X5 CM",
  "GRIFERÍA LAVAMANOS URBAN-N ALTA 22 CM ANTIQUE BRONZE",
  "DOWNLIGHT LED STUDIO SLIM 10W LUZ CÁLIDA NEUTRA Y FRÍA",
  "WC ATENAS A PISO 210 MM",
];

async function totalDe(bvId: string): Promise<number> {
  const items = await prisma.artefactoItem.findMany({
    where: { budgetVersionId: bvId },
    select: { clientPrice: true, quantity: true },
  });
  return items.reduce((acc, i) => acc + i.clientPrice * i.quantity, 0);
}

async function main() {
  console.log("HOST:", HOST);
  console.log("MODO:", APLICAR ? "APLICAR" : "DRY-RUN");
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error("Es la base VIVA y no se pasó --si-la-viva. Abortado.");
  }
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const cats = await prisma.artefactoCatalog.findMany({
    where: { name: { in: NOMBRES } },
    select: {
      id: true, name: true, detail: true, brand: true, listPrice: true,
      discountPercent: true, referenceLink: true, imageUrl: true,
    },
  });

  const versiones = new Set<string>();
  const cambios: Array<{ cat: (typeof cats)[number]; lineas: number }> = [];

  for (const cat of cats) {
    const lineas = await prisma.artefactoItem.findMany({
      where: {
        catalogId: cat.id,
        priceOverridden: false,
        budgetVersion: { status: "borrador" },
      },
      select: {
        id: true, room: true, quantity: true, clientPrice: true, budgetVersionId: true,
        budgetVersion: {
          select: { version: true, project: { select: { name: true } } },
        },
      },
    });
    if (lineas.length === 0) {
      console.log(`── ${cat.name}: ninguna línea de borrador la sigue (o están despegadas).`);
      continue;
    }
    const nuevoCliente = Math.round(cat.listPrice * (1 - (cat.discountPercent ?? 0)));
    console.log(`── ${cat.name} → ${CLP(nuevoCliente)} c/u`);
    for (const l of lineas) {
      versiones.add(l.budgetVersionId);
      const delta = (nuevoCliente - l.clientPrice) * l.quantity;
      console.log(
        `   · ${l.budgetVersion?.project?.name} ${l.budgetVersion?.version} — ${l.room} x${l.quantity}: ` +
          `${CLP(l.clientPrice)} → ${CLP(nuevoCliente)}` +
          (Math.abs(delta) < 1 ? "  (sin cambio)" : `  (${CLP(delta)})`)
      );
    }
    cambios.push({ cat, lineas: lineas.length });
  }

  const antes = new Map<string, number>();
  for (const v of versiones) antes.set(v, await totalDe(v));

  if (!APLICAR) {
    console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  let total = 0;
  for (const { cat } of cambios) {
    const descuento = cat.discountPercent ?? null;
    const res = await prisma.artefactoItem.updateMany({
      where: {
        catalogId: cat.id,
        priceOverridden: false,
        budgetVersion: { status: "borrador" },
      },
      data: {
        name: cat.name,
        detail: cat.detail,
        brand: cat.brand,
        listPrice: cat.listPrice,
        discountPercent: descuento,
        clientPrice: cat.listPrice * (1 - (descuento ?? 0)),
        referenceLink: cat.referenceLink,
        imageUrl: cat.imageUrl,
      },
    });
    total += res.count;
    console.log(`  ${cat.name}: ${res.count} línea(s) actualizada(s)`);
  }
  console.log(`\nTOTAL: ${total} líneas de cotización actualizadas.`);

  console.log("\n═══ TOTAL DE ARTEFACTOS POR COTIZACIÓN ═══");
  for (const v of versiones) {
    const bv = await prisma.budgetVersion.findUnique({
      where: { id: v },
      select: { version: true, project: { select: { name: true } } },
    });
    const ahora = await totalDe(v);
    const ant = antes.get(v)!;
    console.log(
      `  ${bv?.project?.name} ${bv?.version}: ${CLP(ant)} → ${CLP(ahora)}` +
        (Math.abs(ahora - ant) < 1 ? "  (sin cambio)" : `  (${CLP(ahora - ant)})`)
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
