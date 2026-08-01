/**
 * Muestra CÓMO SE VE en el catálogo la limpieza de "lista vs oferta", para que
 * MJ pueda decidir mirando la pantalla y no un número suelto.
 *
 * Corre contra la base de DESARROLLO (ep-solitary-mud), NUNCA la viva: copia
 * los productos del caso tal como están HOY en la viva (solo lectura de ahí),
 * los siembra en dev con un prefijo reconocible, saca la foto del "antes",
 * les aplica el cambio propuesto leyendo la web de verdad, saca la del
 * "después", y al final BORRA lo sembrado.
 *
 * Ningún número está escrito a mano: el "antes" sale de la viva y el "después"
 * de la API de la tienda, igual que lo haría la limpieza real.
 *
 *   npx tsx scripts/verify-catalogo-antes-despues-limpieza.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";

const BASE = process.argv[2] ?? "http://localhost:3157";
const OUT = "docs/auditoria-artefactos-precios-2026-07-assets";

const envDev = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = envDev.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_DEV = envDev.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_VIVA = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];

const dev = new PrismaClient({ datasources: { db: { url: DB_DEV } } });
const viva = new PrismaClient({ datasources: { db: { url: DB_VIVA } } });

// Prefijo para encontrarlos con el buscador y para borrarlos después.
const MARCA = "ZZDEMO";

// Los 5 del dry-run: 3 "seguros" (el cliente paga lo mismo) + 2 donde el
// precio al cliente SÍ cambiaría.
const NOMBRES = [
  "HORNO EMPOTRABLE 71 L",
  "PERCHA ATLAS SIMPLE LATÓN CROMADO 2.5X5.5X5 CM",
  "GRIFERÍA LAVAMANOS URBAN-N ALTA 22 CM ANTIQUE BRONZE",
  "DOWNLIGHT LED STUDIO SLIM 10W LUZ CÁLIDA NEUTRA Y FRÍA",
  "WC ATENAS A PISO 210 MM",
];

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-antes-despues")
    .encrypt(key);
}

async function capturar(page: Page, nombre: string, alto: number) {
  mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/catalogo/artefactos`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/Buscar/i).fill(MARCA);
  await page.waitForTimeout(1500);
  const caja = await page.locator("main").first().boundingBox();
  await page.screenshot({
    path: `${OUT}/${nombre}.png`,
    clip: { x: caja!.x, y: caja!.y + 295, width: caja!.width, height: alto },
  });
  console.log("  capturado:", `${OUT}/${nombre}.png`);
}

async function main() {
  if (!/solitary-mud/.test(DB_DEV)) throw new Error("El sembrado va SOLO a dev. Abortado.");
  console.log("Siembra en:", DB_DEV.match(/@([^/]+)/)?.[1]);
  console.log("Lee (solo lectura) de:", DB_VIVA.match(/@([^/]+)/)?.[1], "\n");

  const ids: string[] = [];
  try {
    // 1. Traer de la viva cómo está hoy cada producto, y de la web el precio real.
    const casos: Array<{ id: string; name: string; listaDespues: number; dctoDespues: number }> = [];
    for (const nombre of NOMBRES) {
      const cat = await viva.artefactoCatalog.findFirst({
        where: { name: nombre },
        select: {
          name: true, detail: true, brand: true, subcategory: true,
          listPrice: true, discountPercent: true, referenceLink: true, imageUrl: true,
        },
      });
      if (!cat) { console.log(`  (no está en la viva: ${nombre})`); continue; }
      const web = await leerPrecioWeb(cat.referenceLink!);
      if (!web) { console.log(`  (no se pudo leer la web de: ${nombre})`); continue; }

      const creado = await dev.artefactoCatalog.create({
        data: {
          name: `${MARCA} ${cat.name}`,
          detail: cat.detail, brand: cat.brand,
          // Para la DEMO se siembran los 5 en la misma pestaña, si no quedan
          // repartidos en Sanitario/Cocina/Iluminación y no se pueden mostrar
          // juntos. Lo que se compara son las columnas de precio, que son
          // idénticas en las tres pestañas.
          subcategory: "sanitario",
          referenceLink: cat.referenceLink, imageUrl: cat.imageUrl,
          listPrice: cat.listPrice, discountPercent: cat.discountPercent,
          lastPriceCheck: new Date(), sortOrder: 99999,
        },
        select: { id: true },
      });
      ids.push(creado.id);
      casos.push({
        id: creado.id, name: cat.name,
        listaDespues: web.listPrice, dctoDespues: web.discount,
      });
      const antes = Math.round(cat.listPrice * (1 - (cat.discountPercent ?? 0)));
      const despues = Math.round(web.listPrice * (1 - web.discount));
      console.log(
        `  ${cat.name}\n     antes: ${cat.listPrice} · ${Math.round((cat.discountPercent ?? 0) * 100)}% → cliente ${antes}` +
        `\n     después: ${web.listPrice} · ${(web.discount * 100).toFixed(1)}% → cliente ${despues}` +
        `\n     ${antes === despues ? "el cliente paga LO MISMO" : `el cliente paga ${despues - antes}`}`
      );
    }

    const alto = 60 + casos.length * 88;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{
      name: "authjs.session-token", value: await cookieDeSesion(),
      domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax",
    }]);
    const page = await ctx.newPage();

    console.log("\nFoto ANTES:");
    await capturar(page, "catalogo-limpieza-antes", alto);

    for (const c of casos) {
      await dev.artefactoCatalog.update({
        where: { id: c.id },
        data: { listPrice: c.listaDespues, discountPercent: c.dctoDespues },
      });
    }

    console.log("Foto DESPUÉS:");
    await capturar(page, "catalogo-limpieza-despues", alto);
    await browser.close();
  } finally {
    for (const id of ids) {
      await dev.artefactoCatalog.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n${ids.length} sembrados borrados — dev queda como estaba.`);
    await dev.$disconnect();
    await viva.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
