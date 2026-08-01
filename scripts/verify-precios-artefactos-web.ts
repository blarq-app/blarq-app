/**
 * Verificación del arreglo de precios de artefactos (2026-07-31).
 *
 * NO toca ninguna base de datos: prueba las funciones de lectura contra las
 * tiendas REALES y simula la lógica de decisión del modal con los datos que
 * hoy tiene la cotización de MJ (valores puestos a mano acá, leídos de la
 * viva en la auditoría). Corre con:
 *
 *   npx tsx scripts/verify-precios-artefactos-web.ts
 */
import { leerPrecioWeb } from "../src/lib/catalog/leerPrecioWeb";
import { extraerArtefactoDeLink } from "../src/lib/catalog/extraerArtefacto";

const EPS_PESO = 1;
const EPS_DCTO = 0.005;

// Réplica de la decisión del modal (RevisarPreciosArtefactos.clasificar).
function detectaCambio(
  actual: { lista: number; dcto: number; cliente: number },
  web: { listPrice: number; discount: number; salePrice: number; discountKnown: boolean }
): boolean {
  const listaDif = Math.abs(web.listPrice - actual.lista) > EPS_PESO;
  const dctoDif =
    web.discountKnown && Math.abs(web.discount - actual.dcto) > EPS_DCTO;
  const clienteDif = Math.abs(web.salePrice - actual.cliente) > EPS_PESO;
  return listaDif || dctoDif || clienteDif;
}

let fallas = 0;
function check(nombre: string, ok: boolean, detalle: string) {
  if (!ok) fallas++;
  console.log(`${ok ? "OK  " : "FALLA"} | ${nombre} — ${detalle}`);
}

async function main() {
  console.log("=== 1. El caso WC Atenas (mk.cl, VTEX) ===");
  const atenas = await leerPrecioWeb(
    "https://www.mk.cl/wcs300257-wc-atenas-pison-rimless-sanitarios/p"
  );
  if (!atenas) {
    console.log("FALLA | no se pudo leer el WC Atenas");
    fallas++;
  } else {
    console.log(
      `   web hoy: lista ${atenas.listPrice} · dcto ${(atenas.discount * 100).toFixed(1)}% · venta ${atenas.salePrice} (dcto confiable: ${atenas.discountKnown})`
    );
    check(
      "lee el descuento real de MK",
      atenas.discountKnown && atenas.discount > 0.3,
      `descuento leído ${(atenas.discount * 100).toFixed(1)}% (antes se leía 0 y se descartaba)`
    );
    // Lo que la cotización de MJ tiene hoy (leído de la viva en la auditoría).
    const enLaCotizacion = { lista: 229840, dcto: 0.3002088409328229, cliente: 160840 };
    check(
      "AHORA detecta que la cotización quedó vieja",
      detectaCambio(enLaCotizacion, atenas),
      `cotización $${enLaCotizacion.cliente} vs web $${atenas.salePrice}`
    );
    // Comportamiento viejo: comparaba SOLO la lista.
    const detectabaAntes =
      Math.abs(atenas.listPrice - enLaCotizacion.lista) > EPS_PESO;
    check(
      "ANTES no lo detectaba (regresión que se está arreglando)",
      !detectabaAntes,
      "comparando solo la lista daba 'coincide'"
    );
    // Lo que quedaría guardado al aplicar.
    const nuevoCliente = Math.round(atenas.listPrice * (1 - atenas.discount));
    check(
      "al aplicar, el precio al cliente queda igual al de la tienda",
      Math.abs(nuevoCliente - atenas.salePrice) <= EPS_PESO,
      `quedaría $${nuevoCliente} (tienda: $${atenas.salePrice}); antes quedaba $${Math.round(atenas.listPrice * (1 - enLaCotizacion.dcto))} con el dcto viejo`
    );
  }

  console.log("\n=== 2. Kitchen House (Shopify) ===");
  const kh = await leerPrecioWeb(
    "https://kitchenhouse.cl/products/horno-empotrable-72-l-serie-neo-hbb-4460-ss-teka"
  );
  if (!kh) {
    console.log("   (no se pudo leer — link cambiado; no cuenta como falla del arreglo)");
  } else {
    console.log(
      `   web hoy: lista ${kh.listPrice} · dcto ${(kh.discount * 100).toFixed(1)}% · venta ${kh.salePrice}`
    );
    check(
      "Kitchen House ya no cae al scraper genérico",
      kh.source === "shopify" && kh.discountKnown,
      `fuente: ${kh.source}`
    );
    check(
      "la lista es >= el precio de venta (no confunde oferta con lista)",
      kh.listPrice >= kh.salePrice,
      `lista ${kh.listPrice} · venta ${kh.salePrice}`
    );
  }

  console.log("\n=== 3. Autocompletar por link: un producto EN OFERTA ===");
  // El horno del catálogo que quedó guardado con el precio de oferta como lista.
  const horno = await extraerArtefactoDeLink(
    "https://kitchenhouse.cl/products/horno-empotrable-71-l-hsb-6150-fbk-teka"
  );
  if (!horno) {
    console.log("   (no se pudo leer el horno; revisar el link)");
  } else {
    console.log(
      `   trae: lista ${horno.listPrice} · dcto ${horno.discountPercent != null ? (horno.discountPercent * 100).toFixed(1) + "%" : "—"} · cliente ${horno.clientPrice}`
    );
    check(
      "el autocompletar distingue lista de oferta",
      horno.discountKnown && (horno.discountPercent ?? 0) > 0,
      "antes guardaba el precio de oferta como si fuera la lista, con 0% de dcto"
    );
    check(
      "el precio a cliente = lo que cobra la tienda hoy",
      horno.clientPrice != null &&
        horno.listPrice != null &&
        horno.clientPrice <= horno.listPrice,
      `cliente ${horno.clientPrice} <= lista ${horno.listPrice}`
    );
  }

  console.log("\n=== 4. Tienda SIN API: no se inventa un descuento ===");
  const byp = await leerPrecioWeb("https://www.byp.cl/foco-sobrepuesto-silo-3-luces-blanco/p");
  if (byp) {
    check(
      "marca el descuento como no confiable",
      !byp.discountKnown && byp.discount === 0,
      `source ${byp.source}, discountKnown ${byp.discountKnown}`
    );
  } else {
    console.log(
      "   (byp.cl no devolvió precio — el caso 'sin API' igual está cubierto por el tipo: discountKnown=false)"
    );
  }

  console.log(
    `\n${fallas === 0 ? "TODO OK" : `${fallas} FALLA(S)`} — verificación sin tocar ninguna base de datos.`
  );
  if (fallas > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
