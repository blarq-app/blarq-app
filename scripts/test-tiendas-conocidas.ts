// Tiendas conocidas (pendiente 181): la app aprende sola una tienda nueva al
// extraer un producto. Prueba contra tiendas REALES y la base del .env
// (solo escribe en la tabla KnownStore, y borra lo que creó).
//   npx tsx scripts/test-tiendas-conocidas.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  aprenderTienda,
  esHostPublico,
  hostPermitidoParaFotos,
  permitirHostDeFoto,
  plataformaDe,
} from "../src/lib/catalog/tiendas";
import { extraerArtefactoDeLink } from "../src/lib/catalog/extraerArtefacto";
import { pareceShopify } from "../src/lib/catalog/fetchShopifyPrice";
import { pareceVtex } from "../src/lib/catalog/fetchVtexPrice";

// Una Shopify que la app NO conoce de arranque: la tienda de Ducasse tampoco
// sirve (es PrestaShop), así que se usa la de un proveedor de artefactos real.
const SHOPIFY_NUEVA = "https://www.verken.cl/products/calefactor-secador-de-toalla-electrico-para-bano-250w-mural-70cm-x-40cm-siena-blanco-1";
// Una tienda genérica que no está en la lista de arranque y sirve las fotos
// desde otro dominio (chc.cl → s3.sa-east-1.amazonaws.com).
const GENERICA_NUEVA = "https://chc.cl/banos/lavamanos-bajo-encimera-gebbo-rebalse-lateral";

let fallas = 0;
function check(nombre: string, ok: boolean, detalle?: unknown) {
  console.log(`${ok ? "ok " : "FALLÓ"} ${nombre}${detalle !== undefined ? " → " + JSON.stringify(detalle) : ""}`);
  if (!ok) fallas++;
}

async function main() {
  const host = (process.env.DATABASE_URL || "").match(/ep-[a-z-]+|localhost/)?.[0];
  console.log("base:", host);
  if (/shy-morning/.test(host ?? "")) throw new Error("ABORTO: no correr este test contra la viva");

  // Limpieza previa de lo que este test puede crear.
  const HOSTS = ["verken.cl", "chc.cl", "s3.sa-east-1.amazonaws.com"];
  await prisma.knownStore.deleteMany({ where: { host: { in: HOSTS } } });

  // 1. Guardas de seguridad del host
  check("localhost no es público", !esHostPublico("localhost"));
  check("IP no es pública", !esHostPublico("10.0.0.1"));
  check("nombre sin dominio no es público", !esHostPublico("intranet"));
  check("verken.cl es público", esHostPublico("verken.cl"));
  check("proxy rechaza host desconocido", !(await hostPermitidoParaFotos("tienda-inventada-xyz.cl")));
  check("proxy acepta tienda de arranque", await hostPermitidoParaFotos("mkchile.vtexassets.com"));

  // 2. Las sondas que detectan la plataforma (lo que antes se verificaba a mano)
  check("sonda Shopify reconoce a Verken", await pareceShopify(SHOPIFY_NUEVA));
  check("sonda Shopify NO reconoce a chc.cl", !(await pareceShopify(GENERICA_NUEVA)));
  check("sonda VTEX reconoce a MK", await pareceVtex("https://www.mk.cl/del360030-mamparas-dellorto-civita/p"));
  check("sonda VTEX NO reconoce a Verken", !(await pareceVtex(SHOPIFY_NUEVA)));

  // Verken viene de arranque como shopify: no se vuelve a probar ni se guarda
  check("verken de arranque = shopify", (await plataformaDe(SHOPIFY_NUEVA)) === "shopify");
  check("verken no se guarda (ya es de arranque)", (await prisma.knownStore.count({ where: { host: "verken.cl" } })) === 0);

  // 3. Tienda genérica nueva: se aprende como generico y su CDN queda permitido
  check("chc.cl desconocida antes", !(await hostPermitidoParaFotos("chc.cl")));
  const plat = await aprenderTienda(GENERICA_NUEVA);
  check("chc.cl aprendida como generico", plat === "generico", plat);
  check("chc.cl permitida para fotos después", await hostPermitidoParaFotos("chc.cl"));
  await permitirHostDeFoto("https://s3.sa-east-1.amazonaws.com/chc-prod/lavamanos.jpg");
  check("CDN de chc permitido", await hostPermitidoParaFotos("s3.sa-east-1.amazonaws.com"));
  const fila = await prisma.knownStore.findUnique({ where: { host: "chc.cl" } });
  check("fila guardada con el link", fila?.sampleUrl === GENERICA_NUEVA, fila);

  // 4. Extracción completa de un producto (el camino real del botón "Extraer")
  const ext = await extraerArtefactoDeLink(SHOPIFY_NUEVA);
  check("extraer Verken: precio por API $149.990", ext?.listPrice === 149990 && ext.discountKnown === true, ext);
  check("extraer Verken: foto permitida por el proxy", !!ext?.imageUrl && (await hostPermitidoParaFotos(new URL(ext.imageUrl).hostname.replace(/^www\./, ""))));

  // 5. Un link que NO es tienda: no se aprende nada
  check("localhost no se aprende", (await aprenderTienda("http://localhost:3000/products/x")) === "generico");
  check("localhost no quedó en la tabla", (await prisma.knownStore.count({ where: { host: "localhost" } })) === 0);

  await prisma.knownStore.deleteMany({ where: { host: { in: HOSTS } } });
  console.log(fallas === 0 ? "\nTODO OK" : `\n${fallas} FALLAS`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
