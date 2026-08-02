/**
 * Revisión de la cotización de Casa Los Algarrobos: qué tiene cada línea, qué
 * dice la web hoy, y por qué el MEZCLADOR URBAN CROMO viene sin marcar en el
 * modal. SOLO LECTURA.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number | null) => `${((d ?? 0) * 100).toFixed(0)}%`;

async function main() {
  const bv = await prisma.budgetVersion.findFirst({
    where: { type: "artefactos", project: { name: { contains: "Algarrobos" } } },
    select: { id: true, version: true, status: true, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!bv) throw new Error("No se encontró la cotización.");
  console.log(`\n${bv.project?.name} ${bv.version} [${bv.status}]\n`);

  const items = await prisma.artefactoItem.findMany({
    where: { budgetVersionId: bv.id },
    select: {
      name: true, room: true, quantity: true, listPrice: true,
      discountPercent: true, clientPrice: true, priceOverridden: true,
      catalogId: true, referenceLink: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  let totalPpto = 0;
  let totalWeb = 0;
  let sinLeer = 0;

  for (const it of items) {
    totalPpto += it.clientPrice * it.quantity;
    const web = it.referenceLink ? await leerPrecioWeb(it.referenceLink) : null;
    const cat = it.catalogId
      ? await prisma.artefactoCatalog.findUnique({
          where: { id: it.catalogId },
          select: { listPrice: true, discountPercent: true },
        })
      : null;

    const estado = it.priceOverridden ? "DESPEGADA" : "sigue al catálogo";
    console.log(`── ${it.name} (${it.room}) x${it.quantity} — ${estado}`);
    console.log(
      `   ppto:     ${CLP(it.listPrice)} · ${PCT(it.discountPercent)} · ${CLP(it.clientPrice)}`
    );
    if (cat) {
      console.log(
        `   catálogo: ${CLP(cat.listPrice)} · ${PCT(cat.discountPercent)} · ${CLP(cat.listPrice * (1 - (cat.discountPercent ?? 0)))}`
      );
    } else {
      console.log("   catálogo: (la línea no está vinculada a un producto del catálogo)");
    }
    if (web) {
      totalWeb += web.salePrice * it.quantity;
      const dif = web.salePrice - it.clientPrice;
      console.log(
        `   web hoy:  ${CLP(web.listPrice)} · ${(web.discount * 100).toFixed(0)}% · ${CLP(web.salePrice)}` +
          (Math.abs(dif) <= 2 ? "   (igual)" : `   → ${CLP(dif)} de diferencia`)
      );
    } else {
      totalWeb += it.clientPrice * it.quantity;
      sinLeer++;
      console.log("   web hoy:  (no se pudo leer el link)");
    }
    console.log();
  }

  console.log("═══════════════════════════════════════");
  console.log(`Total del presupuesto hoy:      ${CLP(totalPpto)}`);
  console.log(`Total a precio de la web hoy:   ${CLP(totalWeb)}`);
  console.log(`Diferencia:                     ${CLP(totalWeb - totalPpto)}`);
  console.log(`(${items.length} ítems · ${sinLeer} sin poder leer el link)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
