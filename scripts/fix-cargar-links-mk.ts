/**
 * Carga los links de MK que MJ confirmó, y de paso el precio real de la tienda
 * (lista + descuento), que en varios estaba en $0.
 *
 * Los links NO se inventan: son los que ella aprobó de la búsqueda del
 * 2026-08-03 (docs/catalogo-busqueda-links-mk-2026-08.md). Antes de escribir,
 * cada uno se lee de la web para confirmar que responde y traer su precio de
 * hoy — si alguno no responde, ese se saltea y se avisa.
 *
 * NO propaga a las cotizaciones: solo toca el catálogo. Las líneas que ya están
 * en un presupuesto conservan su precio; si MJ quiere bajarles el nuevo, es con
 * "Comparar con mi catálogo" desde la cotización.
 *
 *   npx tsx scripts/fix-cargar-links-mk.ts                  # dry-run
 *   npx tsx scripts/fix-cargar-links-mk.ts --aplicar --si-la-viva
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const APLICAR = process.argv.includes("--aplicar");
const OK_VIVA = process.argv.includes("--si-la-viva");

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const HOST = url.match(/@([^/]+)/)![1];
console.log("HOST:", HOST);
console.log("MODO:", APLICAR ? "APLICAR" : "DRY-RUN");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Confirmados por MJ el 2026-08-03. El nombre es el del catálogo BLARQ.
const CONFIRMADOS: Array<{ nombre: string; link: string; nota?: string }> = [
  {
    nombre: "COLUMNA DUCHA TREND 25 CM C/DUCHA FONO GUN GREY",
    link: "https://www.mk.cl/gkl030787-columna-ducha-trend-25-cm-cducha-fono-gun-grey-griferias-de-ducha-y-tina/p",
    nota: "nombre idéntico en MK",
  },
  {
    nombre: "GRIFERIA COCINA BRIZO EXTRAIBLE 1 JET CROMO",
    link: "https://www.mk.cl/gkl030289-griferia-cocina-brizo-flexible-1-jet-cromo-griferias-de-cocina/p",
    nota: "MK lo llama 'Flexible'; el precio de lista calza exacto",
  },
  {
    nombre: "MEZCLADOR STELLAR BRUSHED",
    link: "https://www.mk.cl/gkl030677-mezclador-ducha-stellar-empotrado-1-via-brushed-nickel-griferias-de-ducha-y-tina/p",
  },
  {
    nombre: "PLATO DUCHA LUXOR REDONDO 25CM",
    link: "https://www.mk.cl/gkl030288-plato-ducha-luxor-redondo-25-cm-1-jet-sbrazo-brushed-nickel-griferias-de-ducha-y-tina/p",
  },
  {
    nombre: "MUEBLE ALBANY 700 2 CAJONES MOON GREY C/LAVAMANOS",
    link: "https://www.mk.cl/mdb262707-mueble-de-bano-albany-700-mm-2-cajones-moon-grey-muebles-de-bano/p",
  },
  {
    nombre: "PERCHA ATLAS SIMPLE BRUSHED NICKEL",
    link: "https://www.mk.cl/acc080324-percha-atlas-simple-brushed-nickel-accesorios/p",
  },
];

async function main() {
  if (APLICAR && /shy-morning/.test(HOST) && !OK_VIVA) {
    throw new Error("Es la base VIVA y no se pasó --si-la-viva. Abortado.");
  }
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log("Proyecto #64:", p64?.name ?? "(no está)", "\n");

  const aplicables: Array<{
    id: string; nombre: string; link: string;
    antes: string; despues: string;
    listPrice: number; discount: number; salePrice: number;
    usos: number;
  }> = [];

  for (const conf of CONFIRMADOS) {
    const cat = await prisma.artefactoCatalog.findFirst({
      where: { name: conf.nombre },
      select: { id: true, name: true, listPrice: true, discountPercent: true, referenceLink: true },
    });
    if (!cat) {
      console.log(`OJO  ${conf.nombre} — no está en el catálogo, se saltea\n`);
      continue;
    }
    const web = await leerPrecioWeb(conf.link);
    if (!web) {
      console.log(`OJO  ${conf.name ?? conf.nombre} — el link no respondió, se saltea\n`);
      continue;
    }
    const usos = await prisma.artefactoItem.count({ where: { catalogId: cat.id } });
    aplicables.push({
      id: cat.id,
      nombre: cat.name,
      link: conf.link,
      antes: `${CLP(cat.listPrice)} · ${Math.round((cat.discountPercent ?? 0) * 100)}%${cat.referenceLink ? "" : " · SIN LINK"}`,
      despues: `${CLP(web.listPrice)} · ${(web.discount * 100).toFixed(0)}% · cliente ${CLP(web.salePrice)}`,
      listPrice: web.listPrice,
      discount: web.discount,
      salePrice: web.salePrice,
      usos,
    });
    console.log(`── ${cat.name}${conf.nota ? `  (${conf.nota})` : ""}`);
    console.log(`   antes:   ${aplicables.at(-1)!.antes}`);
    console.log(`   después: ${aplicables.at(-1)!.despues}`);
    console.log(`   se usa en ${usos} línea(s) de cotización — NO se les toca el precio\n`);
  }

  console.log(`Listos para cargar: ${aplicables.length} de ${CONFIRMADOS.length}`);

  if (!APLICAR) {
    console.log("\nDRY-RUN: no se escribió nada.");
    return;
  }

  for (const a of aplicables) {
    await prisma.artefactoCatalog.update({
      where: { id: a.id },
      data: {
        referenceLink: a.link,
        listPrice: a.listPrice,
        discountPercent: a.discount,
        lastPriceCheck: new Date(),
        // Referencia de internet, para que no se pierda si MK lo da de baja.
        webListPrice: a.listPrice,
        webSalePrice: a.salePrice,
        webCheckedAt: new Date(),
        webUnreadableSince: null,
      },
    });
    console.log(`  cargado: ${a.nombre}`);
  }

  console.log("\n═══ VERIFICACIÓN ═══");
  for (const a of aplicables) {
    const c = await prisma.artefactoCatalog.findUnique({
      where: { id: a.id },
      select: { listPrice: true, discountPercent: true, referenceLink: true, webCheckedAt: true },
    });
    const ok = !!c?.referenceLink && c.listPrice === a.listPrice && c.webCheckedAt != null;
    console.log(`  ${ok ? "OK  " : "OJO "} ${a.nombre}: ${CLP(c?.listPrice ?? 0)} · ${Math.round((c?.discountPercent ?? 0) * 100)}% · con link`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
