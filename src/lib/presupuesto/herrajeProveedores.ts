/**
 * Proveedores de herrajes.
 *
 * Hasta el 2026-09-11 eran dos pestañas fijas en la pantalla (DPH y HBT). MJ
 * pidió cargar herrajes de OTROS proveedores (ej. Carlos, su mueblista, que le
 * vende itemizado un herraje de una marca a la que ella no tiene acceso), así
 * que las pestañas se arman con los fijos más cualquier proveedor que exista
 * en el catálogo. En la base el proveedor siempre fue texto libre: lo fijo
 * estaba solo en la pantalla.
 *
 * Los fijos van primero y en ese orden (son los que tienen revisador de
 * precios / mayor volumen); el resto, alfabético. Pura, sin base de datos.
 */
import { formatCLP } from "@/lib/utils";

export const PROVEEDORES_FIJOS = ["DPH", "HBT"] as const;

// Valor centinela del desplegable para "escribir un proveedor nuevo".
export const OTRO_PROVEEDOR = "__otro__";

// Nombre tal como se guarda: sin espacios sobrantes. NO cambia mayúsculas:
// el nombre sale así en el PDF al cliente, y cómo se escribe lo decide MJ.
export function normalizarProveedor(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function proveedoresDe(items: { supplier: string }[]): string[] {
  const fijos = new Set<string>(PROVEEDORES_FIJOS);
  const otros = new Set<string>();
  for (const it of items) {
    const s = normalizarProveedor(it.supplier ?? "");
    if (s && !fijos.has(s)) otros.add(s);
  }
  return [...PROVEEDORES_FIJOS, ...[...otros].sort((a, b) => a.localeCompare(b, "es"))];
}

/**
 * Qué proveedores se pueden comparar contra su web ("Comparar con la tienda
 * web" en la partida de herrajes de la cotización y "Revisar precios" del
 * catálogo, pendiente 143).
 *
 *   - DPH: su precio público ES lo que paga BLARQ. Verificado 2026-09-28 con
 *     10 herrajes contra dph.cl: los 10 calzaban exacto con el costo cargado.
 *   - HBT: desde 2026-10-01, a pedido de MJ ("corregí eso de que sí se pueda
 *     comparar con la web"). Hasta ahí quedaba fuera porque el costo cargado
 *     es el precio que MJ negoció, no el público (Merivobox E: BLARQ paga
 *     $64.000, hbt.cl publica $89.990). Por eso HBT se compara pero con
 *     resguardos (ver tienePrecioNegociado), y su web la lee el NAVEGADOR
 *     (ver seLeeEnElNavegador).
 *   - Cualquier otro (ej. DAPDUCASSE): el lector no lee su web. Se ofrece la
 *     flechita para mirarlo a mano, no el chequeo.
 */
export const PROVEEDORES_PRECIO_WEB = ["DPH", "HBT"] as const;

export function seComparaConLaWeb(supplier: string): boolean {
  return (PROVEEDORES_PRECIO_WEB as readonly string[]).includes(
    normalizarProveedor(supplier ?? "").toUpperCase(),
  );
}

/**
 * Proveedores cuyo costo es un precio NEGOCIADO (HBT). Se comparan con la web,
 * pero lo distinto NO viene marcado de entrada en "Comparar con la tienda web"
 * ni entra en "Aplicar todos los cambios" del catálogo: la diferencia suele
 * ser el descuento de MJ, no un precio viejo, y un clic la borraría (Merivobox
 * E: $64.000 → $89.990). Se aplica uno por uno, marcándolo.
 */
export const PROVEEDORES_PRECIO_NEGOCIADO = ["HBT"] as const;

export function tienePrecioNegociado(supplier: string): boolean {
  return (PROVEEDORES_PRECIO_NEGOCIADO as readonly string[]).includes(
    normalizarProveedor(supplier ?? "").toUpperCase(),
  );
}

/**
 * Proveedores cuya web la lee el NAVEGADOR de MJ y no el servidor: hbt.cl
 * rechaza al servidor de Vercel (403 de Cloudflare, confirmado 2026-09-29)
 * pero abre normal desde Chile y deja que otra página lea sus productos
 * (access-control-allow-origin: *, verificado 2026-10-01). El servidor lo
 * intenta igual primero; si no puede, completa el navegador.
 */
export const PROVEEDORES_WEB_EN_NAVEGADOR = ["HBT"] as const;

export function seLeeEnElNavegador(supplier: string): boolean {
  return (PROVEEDORES_WEB_EN_NAVEGADOR as readonly string[]).includes(
    normalizarProveedor(supplier ?? "").toUpperCase(),
  );
}

/**
 * El precio de la web que vale al APLICAR "Comparar con la tienda web" en una
 * cotización. El servidor lo vuelve a leer (así nadie manda un costo
 * inventado y, si la web cambió entre comparar y aplicar, queda el de ahora).
 * Solo cuando la tienda bloquea al servidor (seLeeEnElNavegador: HBT) y él no
 * pudo leerlo, vale el que leyó el navegador de MJ en la ventana. MJ igual
 * puede escribir cualquier costo a mano: esto no le abre nada nuevo.
 */
export function precioWebParaAplicar(
  supplier: string,
  delServidor: number | null,
  delNavegador: unknown
): number | null {
  if (delServidor != null) return delServidor;
  if (!seLeeEnElNavegador(supplier)) return null;
  const n = typeof delNavegador === "number" ? delNavegador : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Proveedor según el sitio del link, para los que conocemos. Sirve para no
// depender solo del proveedor elegido en el formulario (que por defecto es la
// pestaña activa y MJ puede no haber cambiado).
const PROVEEDOR_POR_SITIO: Record<string, string> = {
  "dph.cl": "DPH",
  "hbt.cl": "HBT",
  "dapducasse.cl": "DAPDUCASSE",
};

export function proveedorDelLink(link: string): string | null {
  try {
    const host = new URL(link.trim()).hostname.toLowerCase().replace(/^www\./, "");
    return PROVEEDOR_POR_SITIO[host] ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿"Extraer" saca el costo del precio EXACTO de la variante en dph.cl?
 * (pendiente 188, 2026-09-29 — esto es plata.)
 *
 * Los productos de DPH vienen en varias medidas y la página muestra el precio
 * de otra: el cajón 119mm daba $26.100 cuando el de 500mm (el que se compra)
 * es $26.900. Por eso con DPH el costo sale de fetchHerrajePrice (por SKU o
 * la única variante), y si no se sabe cuál, queda vacío con aviso.
 *
 * Tienen que calzar LAS DOS pistas: el proveedor del formulario Y el sitio
 * del link (el precio exacto de la variante solo se sabe leer en dph.cl).
 *
 * Hasta 2026-10-01 esto decidía además si el costo se llenaba: con HBT y el
 * resto quedaba VACÍO, porque en HBT el costo es el precio negociado (el
 * Merivobox E se paga $64.000 y hbt.cl publica $89.990). MJ lo cambió al
 * usarlo: "si estoy pidiéndole extraer, que me lo extraiga no más". Ahora
 * todos llenan el costo con el precio de la web y el aviso (avisoCostoDeLaWeb)
 * le recuerda cambiarlo si negoció otro.
 */
export function extraerPrecioExactoDph(proveedor: string, link: string): boolean {
  return (
    normalizarProveedor(proveedor ?? "").toUpperCase() === "DPH" &&
    proveedorDelLink(link) === "DPH"
  );
}

/**
 * El aviso que acompaña al "Extraer" cuando el costo sale del precio de la
 * web de la página (todo lo que no es DPH con variante exacta), en palabras
 * de MJ. Lo usan el servidor (extract) y el navegador (cuando la tienda
 * bloquea al servidor, ver extraerHerraje.ts), para que digan lo mismo.
 */
export function avisoCostoDeLaWeb(
  proveedor: string,
  link: string,
  precioWeb: number | null
): string {
  let host = "";
  try {
    host = new URL(link.trim()).hostname.replace(/^www\./, "");
  } catch {
    /* link inválido: queda el proveedor */
  }
  // El nombre de la tienda de donde salió el precio: el proveedor si el sitio
  // es conocido (dph.cl → DPH), si no la página misma (tienda.cl), no la
  // pestaña del formulario (que puede ser otra).
  const quien = proveedorDelLink(link) ?? (host || proveedor);
  if (!precioWeb) {
    return `${quien}: la web no muestra el precio. Escribí el costo a mano.`;
  }
  return `Costo = precio de la web de ${quien} (${formatCLP(precioWeb)}). Si negociaste otro precio, cambialo.`;
}

// Por qué un proveedor NO se compara, en palabras de MJ (va en pantalla).
// Desde 2026-10-01 HBT sí se compara, así que queda un solo motivo.
export function motivoSinCompararWeb(supplier: string): string {
  void supplier;
  return "su web no se lee";
}
