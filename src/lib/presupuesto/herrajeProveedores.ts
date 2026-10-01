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
 * Qué proveedores se pueden comparar contra su web ("Comparar con la web" en
 * la partida de herrajes de la cotización, pendiente 143).
 *
 * Solo DPH, y NO es solo porque sea el único que el lector sabe leer:
 *   - DPH: su precio público ES lo que paga BLARQ. Verificado 2026-09-28 con
 *     10 herrajes contra dph.cl: los 10 calzaban exacto con el costo cargado.
 *   - HBT: el costo cargado es el precio que MJ negoció, NO el público
 *     (Merivobox E: BLARQ paga $64.000, hbt.cl publica $89.990). Compararlo
 *     marcaría una diferencia que no es un error — aunque algún día el lector
 *     aprenda a leer Magento, HBT sigue fuera de esta comparación.
 *   - Cualquier otro (ej. DAPDUCASSE): el lector no lee su web (devuelve
 *     null). Se ofrece la flechita para mirarlo a mano, no el chequeo.
 */
export const PROVEEDORES_PRECIO_WEB = ["DPH"] as const;

export function seComparaConLaWeb(supplier: string): boolean {
  return (PROVEEDORES_PRECIO_WEB as readonly string[]).includes(
    normalizarProveedor(supplier ?? "").toUpperCase(),
  );
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
  const delSitio = proveedorDelLink(link);
  return seComparaConLaWeb(proveedor) && delSitio != null && seComparaConLaWeb(delSitio);
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
export function motivoSinCompararWeb(supplier: string): string {
  return normalizarProveedor(supplier ?? "").toUpperCase() === "HBT"
    ? "precio negociado"
    : "su web no se lee";
}
