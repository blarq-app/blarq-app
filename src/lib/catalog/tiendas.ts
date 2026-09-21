/**
 * Tiendas conocidas — la ÚNICA lista de tiendas de la app (pendiente 181).
 *
 * Por qué existe: hasta el 2026-09-21 había DOS listas escritas en el código y
 * había que tocarlas a mano por cada tienda nueva: la del proxy de fotos
 * (`api/catalogo/img-proxy`, hosts de los que se dejan servir imágenes) y las
 * de tiendas con API de precios (`SHOPIFY_PRICE_HOSTS`, `VTEX_PRICE_HOSTS`).
 * Hasta que alguien las editaba, la foto de un producto de una tienda nueva
 * salía ROTA sin ningún aviso (pasó con Ducasse y con Verken).
 *
 * Ahora hay dos fuentes que se miran juntas:
 *   1. `TIENDAS_DE_ARRANQUE` (acá abajo): las tiendas que la app ya conocía,
 *      con su plataforma verificada a mano. Siguen en el código para que la app
 *      arranque sabiendo lo básico aunque la tabla esté vacía.
 *   2. La tabla `KnownStore`: las que la app APRENDE sola. Cuando MJ pega el
 *      link de un producto y aprieta "Extraer" (`aprenderTienda`), se anota el
 *      host, se PRUEBA si es Shopify o VTEX pegándole a su API con ese mismo
 *      producto (lo que antes se hacía a mano para cada tienda), y se anota
 *      también el host del que viene la foto (el CDN) para que el proxy la deje
 *      pasar.
 *
 * Seguridad: la lista del proxy existe para que la app no sirva de puente para
 * bajar cualquier cosa de cualquier sitio (SSRF / proxy abierto). Las tiendas
 * aprendidas las mete solo alguien logueado al extraer un producto, y
 * `esHostPublico` rechaza direcciones internas (localhost, IPs, sin dominio).
 * El extractor ya entraba a cualquier URL que le pegaran, así que esto no abre
 * nada que no estuviera abierto.
 */

import { prisma } from "@/lib/prisma";

export type Plataforma = "shopify" | "vtex" | "generico";
/** Lo que se guarda por host: la plataforma de la tienda, o "cdn" si el host solo sirve fotos. */
export type KindTienda = Plataforma | "cdn";

// Tiendas que la app conocía antes de la tabla. Se acepta el host exacto o
// cualquier subdominio. Las plataformas están verificadas contra un producto
// real (fechas en el historial de fetchShopifyPrice.ts / fetchVtexPrice.ts).
const TIENDAS_DE_ARRANQUE: Record<string, KindTienda> = {
  // VTEX (API /api/catalog_system/pub/products/search/<slug>/p)
  "mk.cl": "vtex", // verificada 2026-06
  "ledstudio.cl": "vtex", // verificada 2026-06-12
  // Shopify (API /products/<handle>.js)
  "kitchenhouse.cl": "shopify", // verificada 2026-07-14 (Teka)
  "verken.cl": "shopify", // verificada 2026-09-21 (secadores de toallas)
  // Tiendas sin API conocida: se lee el HTML (foto/nombre/marca, un solo precio)
  "sodimac.cl": "generico",
  "sodimac.com": "generico",
  "easy.cl": "generico",
  "falabella.com": "generico",
  "dph.cl": "generico", // herrajes DPH (Shopify, pero sus fotos van por cdn.shopify.com)
  "hbt.cl": "generico", // herrajes HBT (Magento)
  "dapducasse.cl": "generico", // Ducasse (PrestaShop)
  // CDNs de las tiendas de arriba: solo fotos
  "vtexassets.com": "cdn",
  "vteximg.com.br": "cdn",
  "scene7.com": "cdn",
  "cdn.shopify.com": "cdn",
};

// ─── Hosts ──────────────────────────────────────────────────────────────

/** Host normalizado (sin "www.") de una URL, o null si no parsea. */
export function hostDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * ¿Es un host público de internet? Rechaza lo que no debería servir un proxy:
 * localhost, direcciones IP (v4 o v6), nombres sin dominio y sufijos internos.
 */
export function esHostPublico(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4
  if (host.includes(":") || host.startsWith("[")) return false; // IPv6
  if (!host.includes(".")) return false; // "intranet", "db"
  if (/\.(local|internal|lan|home|corp|localdomain)$/.test(host)) return false;
  return /^[a-z0-9.-]+$/.test(host);
}

function coincide(host: string, conocido: string): boolean {
  return host === conocido || host.endsWith("." + conocido);
}

// Cache chico en memoria de la tabla: el proxy de fotos se llama una vez por
// imagen y no tiene sentido ir a la base por cada una. Se refresca solo y se
// invalida al aprender una tienda.
let cacheAprendidas: { lista: { host: string; kind: KindTienda }[]; hasta: number } | null = null;
const CACHE_MS = 60_000;

async function tiendasAprendidas(): Promise<{ host: string; kind: KindTienda }[]> {
  const ahora = Date.now();
  if (cacheAprendidas && cacheAprendidas.hasta > ahora) return cacheAprendidas.lista;
  try {
    const filas = await prisma.knownStore.findMany({ select: { host: true, kind: true } });
    const lista = filas.map((f) => ({ host: f.host, kind: f.kind as KindTienda }));
    cacheAprendidas = { lista, hasta: ahora + CACHE_MS };
    return lista;
  } catch {
    // Sin base (o tabla todavía no creada): la app sigue con las de arranque.
    return cacheAprendidas?.lista ?? [];
  }
}

/** Qué sabemos de este host: su kind, o null si no es una tienda conocida. */
async function kindDeHost(host: string): Promise<KindTienda | null> {
  for (const [conocido, kind] of Object.entries(TIENDAS_DE_ARRANQUE)) {
    if (coincide(host, conocido)) return kind;
  }
  for (const t of await tiendasAprendidas()) {
    if (coincide(host, t.host)) return t.kind;
  }
  return null;
}

/** ¿El proxy puede servir una foto que vive en este host? */
export async function hostPermitidoParaFotos(host: string): Promise<boolean> {
  if (!esHostPublico(host)) return false;
  return (await kindDeHost(host)) != null;
}

/** Plataforma de la tienda de un link de producto (para leer precio y foto por su API). */
export async function plataformaDe(url: string): Promise<Plataforma> {
  const host = hostDe(url);
  if (!host) return "generico";
  const kind = await kindDeHost(host);
  return kind === "shopify" || kind === "vtex" ? kind : "generico";
}

// ─── Aprender ───────────────────────────────────────────────────────────

/**
 * Prueba con el producto real si la tienda expone la API de Shopify o la de
 * VTEX. Es lo mismo que antes se hacía a mano al "verificar" una tienda: si
 * su endpoint responde un precio válido para ESTE producto, es de esa
 * plataforma. Se importan acá adentro para no armar un ciclo de módulos
 * (esos archivos consultan `plataformaDe`).
 */
async function detectarPlataforma(url: string): Promise<Plataforma> {
  const { pareceShopify } = await import("./fetchShopifyPrice");
  if (await pareceShopify(url)) return "shopify";
  const { pareceVtex } = await import("./fetchVtexPrice");
  if (await pareceVtex(url)) return "vtex";
  return "generico";
}

async function guardar(host: string, kind: KindTienda, sampleUrl: string | null) {
  await prisma.knownStore.upsert({
    where: { host },
    create: { host, kind, sampleUrl },
    // Una tienda que ya estaba como "generico" o "cdn" puede subir a
    // shopify/vtex si ahora se detectó; nunca al revés (una detección fallida
    // por timeout no debe degradar una tienda que ya funcionaba por API).
    update: kind === "shopify" || kind === "vtex" ? { kind, sampleUrl } : {},
  });
  cacheAprendidas = null;
}

/**
 * Aprende la tienda de un link de producto. Se llama ANTES de leer el precio,
 * así la primera extracción ya sale por la API si la tienda la tiene.
 * Devuelve la plataforma (la ya conocida, o la recién detectada). Nunca
 * lanza: si algo falla, la extracción sigue como tienda genérica.
 */
export async function aprenderTienda(url: string): Promise<Plataforma> {
  const host = hostDe(url);
  if (!host || !esHostPublico(host)) return "generico";
  try {
    const conocido = await kindDeHost(host);
    if (conocido === "shopify" || conocido === "vtex") return conocido;
    // "generico", "cdn" o desconocida: probar si tiene API. Las genéricas de
    // arranque no se vuelven a probar (ya se verificó a mano que no tienen).
    if (conocido === "generico" && Object.keys(TIENDAS_DE_ARRANQUE).some((c) => coincide(host, c))) {
      return "generico";
    }
    const plataforma = await detectarPlataforma(url);
    await guardar(host, plataforma, url);
    return plataforma;
  } catch {
    return "generico";
  }
}

/**
 * Anota el host del que viene una foto (el CDN de la tienda) para que el proxy
 * la deje pasar. Va aparte de la tienda porque muchas sirven las fotos desde
 * otro dominio (chc.cl → s3.sa-east-1.amazonaws.com, Sodimac → media.falabella.com).
 */
export async function permitirHostDeFoto(imageUrl: string | null | undefined): Promise<void> {
  const host = hostDe(imageUrl);
  if (!host || !esHostPublico(host)) return;
  try {
    if ((await kindDeHost(host)) != null) return;
    await guardar(host, "cdn", imageUrl ?? null);
  } catch {
    // Sin base: la foto igual queda guardada; el proxy la servirá cuando la tienda se aprenda.
  }
}
