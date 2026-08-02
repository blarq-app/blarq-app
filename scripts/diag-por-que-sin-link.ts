/**
 * ¿Por qué un producto del catálogo está sin link? SOLO LECTURA.
 *
 * Dos hipótesis de MJ (2026-08-02) que hay que separar antes de "arreglar"
 * nada:
 *   1. "Quizás esos productos los creé yo" — cargados a mano, nunca tuvieron
 *      link. No es un error: es un producto que no se compró por internet.
 *   2. "Cuando se acaba un producto en MK lo dan de baja, y si llega un mes
 *      después vuelve a aparecer" — un link que hoy no responde puede volver a
 *      funcionar. No hay que darlo por muerto ni borrarlo.
 *
 * El rastro de haber venido de la web queda en los datos: el scraper deja la
 * foto en el CDN de la tienda y un detalle largo (el nombre completo del
 * producto). Un producto cargado a mano tiene foto subida o ninguna, y detalle
 * corto o vacío.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
console.log("HOST:", url.match(/@([^/]+)/)![1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const CLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// ¿La foto viene del CDN de una tienda? Entonces alguna vez se extrajo de la web.
function fotoDeTienda(u: string | null): boolean {
  if (!u || !u.startsWith("http")) return false;
  try {
    const h = new URL(u).hostname;
    return /vtexassets|vteximg|shopify|kitchenhouse|byp\.cl|mk\.cl|ledstudio/.test(h);
  } catch {
    return false;
  }
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    select: {
      id: true, name: true, detail: true, listPrice: true, imageUrl: true,
      referenceLink: true, lastPriceCheck: true, createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  const creadosAMano: string[] = [];
  const perdieronElLink: string[] = [];
  const linkNoResponde: Array<{ name: string; link: string; nota: string }> = [];

  for (const c of cats) {
    if (c.referenceLink) {
      const web = await leerPrecioWeb(c.referenceLink);
      if (!web) {
        // ¿Alguna vez se leyó bien? Si tiene lastPriceCheck y un precio real,
        // el link funcionó antes: es una baja (quizá temporal), no un error de
        // carga.
        const funcionoAntes = !!c.lastPriceCheck && c.listPrice > 0;
        linkNoResponde.push({
          name: c.name,
          link: c.referenceLink,
          nota: funcionoAntes
            ? `funcionó antes (última lectura ${c.lastPriceCheck!.toISOString().slice(0, 10)}) — puede ser baja temporal`
            : "nunca se leyó bien — el link puede estar mal desde el principio",
        });
      }
      continue;
    }
    // Sin link: ¿tiene rastro de haber venido de la web?
    const rastro = fotoDeTienda(c.imageUrl) || (c.detail?.length ?? 0) > 40;
    const linea = `${c.name}  ·  ${CLP(c.listPrice)}${c.imageUrl ? "" : "  · sin foto"}`;
    if (rastro) perdieronElLink.push(`${linea}  ← tiene foto o detalle de la tienda`);
    else creadosAMano.push(linea);
  }

  console.log(`\n═══ SIN LINK, con pinta de CARGADOS A MANO (${creadosAMano.length}) ═══`);
  console.log("Sin foto de tienda ni detalle largo: nunca vinieron de un link.");
  console.log("No es un error — pero si existen en MK, linkearlos les daría precio automático.\n");
  for (const l of creadosAMano) console.log(`  · ${l}`);

  console.log(`\n\n═══ SIN LINK pero con RASTRO de la web (${perdieronElLink.length}) ═══`);
  console.log("Tienen foto del CDN de la tienda o el detalle completo del producto:");
  console.log("alguien les borró el link, o se cargaron copiando otro.\n");
  for (const l of perdieronElLink) console.log(`  · ${l}`);

  console.log(`\n\n═══ CON LINK QUE HOY NO RESPONDE (${linkNoResponde.length}) ═══`);
  console.log("OJO: MK da de baja productos sin stock y los repone. NO conviene");
  console.log("borrar estos links: hay que reintentarlos más adelante.\n");
  for (const l of linkNoResponde) {
    console.log(`  · ${l.name}`);
    console.log(`      ${l.nota}`);
  }

  console.log(
    `\n\nRESUMEN: ${creadosAMano.length} cargados a mano · ${perdieronElLink.length} perdieron el link · ${linkNoResponde.length} con link caído`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
