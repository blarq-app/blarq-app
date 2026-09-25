// Un link antiguo de MK abre en el navegador, pero su slug ya no existe en
// la API. La lectura debe seguir la redirección dentro de la misma tienda.
import assert from "node:assert/strict";
import { fetchVtexPrice } from "../src/lib/catalog/fetchVtexPrice";

const oldUrl = "https://www.mk.cl/acc080034-pro-asis-stapa-cr-accesorios/p";
const newUrl = "https://www.mk.cl/acc080034-accesorios-klipen-asis/p";
const oldApi = "https://www.mk.cl/api/catalog_system/pub/products/search/acc080034-pro-asis-stapa-cr-accesorios/p";
const newApi = "https://www.mk.cl/api/catalog_system/pub/products/search/acc080034-accesorios-klipen-asis/p";
const product = [{ items: [{ sellers: [{ commertialOffer: { Price: 40990, ListPrice: 51490 } }] }] }];
const realFetch = globalThis.fetch;

async function main() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === oldApi) return Response.json([]);
    if (url === newApi) return Response.json(product);
    if (url === oldUrl && init?.method === "HEAD") {
      return new Response(null, { status: 301, headers: { location: newUrl } });
    }
    if (url === newUrl && init?.method === "HEAD") return new Response(null);
    throw new Error(`Consulta inesperada: ${url}`);
  }) as typeof fetch;

  assert.deepEqual(await fetchVtexPrice(oldUrl), { price: 40990, listPrice: 51490 });
  assert.deepEqual(calls, [
    `GET ${oldApi}`,
    `HEAD ${oldUrl}`,
    `HEAD ${newUrl}`,
    `GET ${newApi}`,
  ]);

  calls.length = 0;
  assert.deepEqual(await fetchVtexPrice(newUrl), { price: 40990, listPrice: 51490 });
  assert.deepEqual(calls, [`GET ${newApi}`]);

  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === oldApi) return Response.json([]);
    if (url === oldUrl && init?.method === "HEAD") {
      return new Response(null, { status: 301, headers: { location: "https://otra-tienda.cl/otro/p" } });
    }
    throw new Error(`No se debe consultar otra tienda: ${url}`);
  }) as typeof fetch;
  assert.equal(await fetchVtexPrice(oldUrl), null);
  assert.deepEqual(calls, [`GET ${oldApi}`, `HEAD ${oldUrl}`]);

  console.log("3 casos OK: link antiguo, link vigente y redirección a otra tienda");
}

main().finally(() => { globalThis.fetch = realFetch; });
