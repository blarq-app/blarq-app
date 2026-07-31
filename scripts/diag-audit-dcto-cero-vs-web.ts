/**
 * Auditoría precios artefactos — SOLO LECTURA.
 * Para las entradas del catálogo con dcto 0 y link a MK/LED/KH, consulta la
 * web de HOY y compara: ¿la lista guardada es en realidad el precio CON
 * descuento (síntoma pre-fix #296), o el producto de verdad no tiene dcto?
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { fetchVtexPrice, isVtexStoreUrl } from "../src/lib/catalog/fetchVtexPrice";
import { fetchShopifyPrice, isShopifyStoreUrl } from "../src/lib/catalog/fetchShopifyPrice";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    where: { referenceLink: { not: null }, OR: [{ discountPercent: null }, { discountPercent: 0 }] },
    select: { name: true, subcategory: true, listPrice: true, clientPrice: true, referenceLink: true, lastPriceCheck: true },
  });
  const targets = cats.filter((c) => /mk\.cl|ledstudio\.cl|kitchenhouse\.cl/.test(c.referenceLink!));
  console.log("Candidatos (dcto 0 con link MK/LED/KH):", targets.length);

  for (const c of targets) {
    const link = c.referenceLink!;
    const web = isVtexStoreUrl(link) ? await fetchVtexPrice(link) : isShopifyStoreUrl(link) ? await fetchShopifyPrice(link) : null;
    if (!web) { console.log(`SIN LECTURA | ${c.name} | ${link}`); continue; }
    const webDcto = web.listPrice > 0 ? Math.round((1 - web.price / web.listPrice) * 1000) / 10 : 0;
    const guardadaEsPrecioConDcto = Math.abs(c.listPrice - web.price) <= 5 && web.price < web.listPrice;
    const flag = guardadaEsPrecioConDcto ? "LISTA=PRECIO-CON-DCTO" : webDcto > 0 ? "DCTO WEB NO CAPTURADO" : "ok-sin-dcto";
    console.log(`${flag} | ${c.name} [${c.subcategory}] | guardado lista=${c.listPrice} | web lista=${web.listPrice} venta=${web.price} dcto=${webDcto}%`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
