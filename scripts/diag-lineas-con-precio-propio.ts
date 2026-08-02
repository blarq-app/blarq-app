/**
 * Las líneas despegadas que tienen el precio distinto al catálogo: ¿qué les
 * falta para volver al circuito? SOLO LECTURA.
 *
 * Principio de MJ (2026-08-02): "TODO debe estar linkeado a la web. Si yo le
 * puse dcto a Teka es independiente de que el precio lista venga de la web".
 * O sea: ninguna línea debería estar despegada solo para conservar un
 * descuento — para eso está `discountOverridden` desde hoy.
 *
 * Para cada una muestra: si tiene link y vínculo al catálogo, qué dice la web
 * hoy, y qué pasaría con el precio al cliente si se la pega conservando su
 * descuento. Ese último número es el que MJ tiene que mirar antes de decidir.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number | null) => `${Math.round((d ?? 0) * 100)}%`;

async function main() {
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const items = await prisma.artefactoItem.findMany({
    where: {
      priceOverridden: true,
      budgetVersion: { type: "artefactos", status: "borrador" },
    },
    select: {
      id: true, name: true, room: true, quantity: true, listPrice: true,
      discountPercent: true, clientPrice: true, catalogId: true, referenceLink: true,
      budgetVersion: { select: { version: true, project: { select: { name: true } } } },
    },
  });

  for (const it of items) {
    const cat = it.catalogId
      ? await prisma.artefactoCatalog.findUnique({
          where: { id: it.catalogId },
          select: { listPrice: true, discountPercent: true, referenceLink: true },
        })
      : null;
    const link = it.referenceLink ?? cat?.referenceLink ?? null;
    const web = link ? await leerPrecioWeb(link) : null;

    console.log(`── ${it.name} (${it.room}) x${it.quantity}`);
    console.log(`   ${it.budgetVersion?.project?.name} ${it.budgetVersion?.version}`);
    console.log(
      `   en el ppto:  ${CLP(it.listPrice)} · ${PCT(it.discountPercent)} · ${CLP(it.clientPrice)}`
    );
    console.log(
      `   vínculos:    catálogo ${it.catalogId ? "SÍ" : "NO"} · link en la línea ${it.referenceLink ? "SÍ" : "NO"}${!it.referenceLink && cat?.referenceLink ? " (pero el catálogo tiene uno)" : ""}`
    );
    if (cat) {
      console.log(
        `   catálogo:    ${CLP(cat.listPrice)} · ${PCT(cat.discountPercent)} · ${CLP(cat.listPrice * (1 - (cat.discountPercent ?? 0)))}`
      );
    }
    if (web) {
      console.log(
        `   web hoy:     ${CLP(web.listPrice)} · ${(web.discount * 100).toFixed(0)}% · ${CLP(web.salePrice)}`
      );
      // Qué pasaría al pegarla conservando SU descuento (el modelo nuevo).
      const conSuDcto = Math.round(web.listPrice * (1 - (it.discountPercent ?? 0)));
      const delta = conSuDcto - it.clientPrice;
      console.log(
        `   → si se pega con TU ${PCT(it.discountPercent)} sobre la lista de la web: ${CLP(conSuDcto)}` +
          (Math.abs(delta) <= 1 ? "  (igual)" : `  (${delta > 0 ? "+" : ""}${CLP(delta)})`)
      );
      const siguiendoLaTienda = web.salePrice;
      console.log(
        `   → si se pega siguiendo el dcto de la tienda: ${CLP(siguiendoLaTienda)}  (${siguiendoLaTienda - it.clientPrice > 0 ? "+" : ""}${CLP(siguiendoLaTienda - it.clientPrice)})`
      );
    } else {
      console.log(`   web hoy:     NO SE PUDO LEER${link ? ` — ${link}` : " — la línea no tiene link"}`);
    }
    console.log();
  }
  console.log(`Total: ${items.length} líneas despegadas con precio propio.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
