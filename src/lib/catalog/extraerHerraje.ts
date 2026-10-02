/**
 * "Extraer" de herrajes desde los dos formularios (alta en la cotización de
 * muebles y "+ Nuevo herraje" del catálogo). Corre en el NAVEGADOR.
 *
 * 1. Primero el servidor (/api/catalogo/herrajes/extract), como siempre: él
 *    decide el costo (solo DPH, con la variante exacta).
 * 2. Si el servidor no pudo entrar a la tienda, lo intenta el navegador de MJ.
 *    hbt.cl bloquea a los servidores de Vercel (403 de Cloudflare en ~0,3 s,
 *    confirmado 2026-09-29), así que con HBT el "Extraer" no traía nada y MJ
 *    tenía que cargar nombre y foto a mano. Pidió arreglarlo (2026-10-01).
 *    Desde su navegador hbt.cl abre normal (~10 s), y deja que otra página
 *    lea sus productos y fotos: responde `access-control-allow-origin: *` en
 *    la página y en las fotos (verificado 2026-10-01). No se salta ningún
 *    bloqueo: es la misma página que MJ abre a mano, pedida por ella.
 *
 * En el camino del navegador:
 *   - La página se lee con el MISMO lector que usa el servidor
 *     (extractGenericProductData), para que salga igual.
 *   - La foto se baja acá y viaja como data URL: el servidor la guarda como
 *     copia (cajón de fotos) sin tener que ir a hbt.cl, que lo rechazaría.
 *   - El costo, igual que en el servidor: el precio de la web, con el aviso
 *     que recuerda cambiarlo si MJ negoció otro (desde 2026-10-01; antes
 *     quedaba vacío). Excepción: DPH, cuyo precio exacto de la variante sabe
 *     leerlo solo el servidor; la página muestra el de otra medida, así que
 *     ahí el costo queda vacío con aviso.
 */
import { extractGenericProductData } from "@/lib/catalog/fetchArtefactoData";
import { fileToThumbnailDataUrl } from "@/lib/imageThumbnail";
import { avisoCostoDeLaWeb, extraerPrecioExactoDph } from "@/lib/presupuesto/herrajeProveedores";
import { formatCLP } from "@/lib/utils";

export interface HerrajeExtraido {
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  costNet: number | null;
  avisoCosto: string | null;
}

// Fallas del servidor que el navegador puede salvar: la tienda lo bloquea, no
// le contesta a tiempo o le da error. "no-existe" (404) y "sin-datos" no: la
// página es la misma para los dos.
const RECUPERABLES_EN_NAVEGADOR = new Set([
  "bloqueado",
  "sin-respuesta",
  "sin-conexion",
  "error-tienda",
]);

// hbt.cl tarda ~10 s desde Santiago: mismo techo que el servidor (25 s).
const ESPERA_MS = 25_000;

async function traer(url: string): Promise<Response | null> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal: corte.signal });
    return res.ok ? res : null;
  } catch {
    // CORS negado, sin red o se pasó del tiempo: el navegador tampoco puede.
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

async function fotoComoDataUrl(imageUrl: string): Promise<string | null> {
  const res = await traer(imageUrl);
  if (!res) return null;
  try {
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    // Misma miniatura que "Subir foto" (600 px, JPEG).
    return await fileToThumbnailDataUrl(new File([blob], "foto", { type: blob.type }));
  } catch {
    return null;
  }
}

async function extraerEnNavegador(
  url: string,
  proveedor: string
): Promise<HerrajeExtraido | null> {
  const res = await traer(url);
  if (!res) return null;
  const html = await res.text().catch(() => "");
  if (!html) return null;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const d = extractGenericProductData(url, html, host.split(".")[0]);
  if (!d.name && !d.imageUrl) return null;
  const imageUrl = d.imageUrl ? await fotoComoDataUrl(d.imageUrl) : null;
  if (extraerPrecioExactoDph(proveedor, url)) {
    const publica = d.listPrice ? ` (la web publica ${formatCLP(d.listPrice)})` : "";
    return {
      name: d.name,
      brand: d.brand,
      imageUrl,
      costNet: null,
      avisoCosto: `El precio exacto de la medida no se pudo leer${publica}: escribí el costo a mano.`,
    };
  }
  return {
    name: d.name,
    brand: d.brand,
    imageUrl,
    costNet: d.listPrice,
    avisoCosto: avisoCostoDeLaWeb(proveedor, url, d.listPrice),
  };
}

/**
 * Precio de hoy en la web, leído por el NAVEGADOR (para "Comparar con la
 * tienda web" y "Revisar precios" de los proveedores que bloquean al servidor,
 * ver seLeeEnElNavegador). Mismo lector que el servidor. null si no se pudo.
 */
export async function precioWebEnNavegador(url: string): Promise<number | null> {
  const res = await traer(url);
  if (!res) return null;
  const html = await res.text().catch(() => "");
  if (!html) return null;
  return extractGenericProductData(url, html, "web").listPrice;
}

/**
 * Lo mismo para varios links, de a pocos a la vez: hbt.cl tarda ~10 s por
 * página y no conviene abrirle 15 conexiones juntas. Cada link se lee una vez.
 */
export async function preciosWebEnNavegador(
  links: string[],
  deAPocos = 4
): Promise<Map<string, number | null>> {
  const unicos = [...new Set(links)];
  const precios = new Map<string, number | null>();
  let siguiente = 0;
  async function trabajar() {
    while (siguiente < unicos.length) {
      const link = unicos[siguiente++];
      precios.set(link, await precioWebEnNavegador(link).catch(() => null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(deAPocos, unicos.length) }, trabajar));
  return precios;
}

export async function extraerHerraje(params: {
  url: string;
  proveedor: string;
  sku: string;
}): Promise<{ ok: true; data: HerrajeExtraido } | { ok: false; error: string }> {
  const url = params.url.trim();
  const qs = new URLSearchParams({ url, proveedor: params.proveedor, sku: params.sku.trim() });
  let error = "No se pudo extraer del link.";
  try {
    const res = await fetch(`/api/catalogo/herrajes/extract?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as HerrajeExtraido };
    if (data?.error) error = data.error;
    if (!RECUPERABLES_EN_NAVEGADOR.has(data?.motivo)) return { ok: false, error };
  } catch {
    // El servidor de la app no respondió: igual vale intentar desde acá.
  }
  const desdeNavegador = await extraerEnNavegador(url, params.proveedor);
  return desdeNavegador ? { ok: true, data: desdeNavegador } : { ok: false, error };
}
