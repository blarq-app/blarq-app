// Prueba contra la tienda real: Verken (Shopify) se lee por su API .js
// (pendiente 180). Sin base de datos, solo red.
//   npx tsx scripts/test-verken-shopify.ts
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";
import { leerFotoWeb } from "../src/lib/catalog/leerFotoWeb";
import { isShopifyStoreUrl } from "../src/lib/catalog/fetchShopifyPrice";

const URL_SIENA =
  "https://www.verken.cl/products/calefactor-secador-de-toalla-electrico-para-bano-250w-mural-70cm-x-40cm-siena-blanco-1";

async function main() {
  console.log("isShopifyStoreUrl:", isShopifyStoreUrl(URL_SIENA));
  const precio = await leerPrecioWeb(URL_SIENA);
  console.log("precio:", precio);
  const foto = await leerFotoWeb(URL_SIENA);
  console.log("foto:", foto);
  const ok = precio?.source === "shopify" && precio.salePrice === 149990 && !!foto?.includes("cdn.shopify.com");
  console.log(ok ? "OK" : "FALLÓ");
  process.exit(ok ? 0 : 1);
}
main();
