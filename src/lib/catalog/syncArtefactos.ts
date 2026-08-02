/**
 * Propagación de precios CATÁLOGO → COTIZACIONES para artefactos.
 *
 * Rediseño precios artefactos 2026-06-18 (ver ADR
 * docs/decisions/2026-06-18-artefactos-precios-catalogo-a-cotizacion.md).
 *
 * El catálogo de artefactos es el precio MAESTRO. Cuando se edita un item del
 * catálogo (a mano o aplicando "Revisar precios"), el cambio BAJA a las líneas
 * de cotizaciones que lo usan, SIEMPRE que:
 *   - apunten a ese item (catalogId),
 *   - NO hayan sido editadas a mano en la cotización (priceOverridden=false),
 *   - estén en BORRADOR (las enviadas/aprobadas quedan congeladas: el catálogo
 *     nunca toca lo que el cliente ya vio, igual que en obra).
 *
 * Esto es DISTINTO a la regla de obra (donde el catálogo es opt-in y no
 * propaga solo). Es una decisión consciente de MJ: para artefactos el flujo
 * es como ella arma el presupuesto, el maestro manda sobre los borradores.
 *
 * Estas dos funciones son puras/aisladas a propósito, para poder testearlas
 * sin levantar el servidor (scripts/test-artefactos-propagacion.ts).
 */

import { prisma } from "@/lib/prisma";

// Campos del catálogo que viajan a la línea de cotización. El clientPrice se
// recalcula con la MISMA convención que al agregar del catálogo:
// listPrice × (1 − descuento). NO se toca realCostBlarq (costo interno, por
// proyecto) ni quantity/room/sortOrder (propios de la línea).
export interface CatalogArtefactoData {
  name: string;
  detail: string | null;
  brand: string | null;
  listPrice: number;
  discountPercent: number | null;
  referenceLink: string | null;
  imageUrl: string | null;
}

/**
 * Propaga los datos de un item de catálogo a las líneas de cotización que lo
 * siguen (borrador + no despegadas). Devuelve cuántas líneas se actualizaron.
 *
 * Dos grupos, desde el cambio del 2026-08-02:
 *   - Las que usan el descuento de la tienda reciben todo, como siempre.
 *   - Las que tienen un descuento puesto por MJ (`discountOverridden`) reciben
 *     el precio de LISTA y los datos del producto, pero conservan SU
 *     porcentaje; el precio a cliente se recalcula con ese porcentaje. Antes
 *     esas líneas no existían: mover el descuento las despegaba y no recibían
 *     nada nunca más.
 */
export async function propagateCatalogToBorradores(
  catalogId: string,
  cat: CatalogArtefactoData
): Promise<number> {
  const descuento = cat.discountPercent ?? null;
  const comun = {
    name: cat.name,
    detail: cat.detail,
    brand: cat.brand,
    listPrice: cat.listPrice,
    referenceLink: cat.referenceLink,
    imageUrl: cat.imageUrl,
  };
  const base = {
    catalogId,
    priceOverridden: false,
    budgetVersion: { status: "borrador" as const },
  };

  // Grupo 1: el descuento lo manda la tienda.
  const conDctoDeTienda = await prisma.artefactoItem.updateMany({
    where: { ...base, discountOverridden: false },
    data: {
      ...comun,
      discountPercent: descuento,
      clientPrice: cat.listPrice * (1 - (descuento ?? 0)),
    },
  });

  // Grupo 2: el descuento es de MJ. Hay que recalcular el precio a cliente con
  // el porcentaje de CADA línea, así que no se puede hacer en un updateMany.
  const propias = await prisma.artefactoItem.findMany({
    where: { ...base, discountOverridden: true },
    select: { id: true, discountPercent: true },
  });
  for (const linea of propias) {
    await prisma.artefactoItem.update({
      where: { id: linea.id },
      data: {
        ...comun,
        clientPrice: cat.listPrice * (1 - (linea.discountPercent ?? 0)),
      },
    });
  }

  return conDctoDeTienda.count + propias.length;
}

// Valores previos de la línea relevantes para decidir el "despegue".
export interface PrevLineaPrecio {
  priceOverridden: boolean;
  listPrice: number;
  discountPercent: number | null;
  clientPrice: number;
  name: string;
  detail: string | null;
  brand: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
}

// Valores entrantes (lo que el editor manda al guardar la línea).
export interface IncomingLineaPrecio {
  listPrice: number;
  discountPercent: number;
  clientPrice: number;
  name: string | null;
  detail: string | null;
  brand: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
}

const dif = (a: number, b: number) => Math.abs(a - b) > 0.01;

/**
 * ¿La edición DESPEGA la línea del catálogo?
 *
 * Solo si MJ fijó a mano un precio: el de LISTA, o el precio final al cliente
 * por un camino que no sea el descuento. Eso significa "este número lo pongo yo
 * y no quiero que nadie lo toque".
 *
 * Lo que ya NO despega (cambio 2026-08-02):
 *   - El DESCUENTO. Es el gesto más común de MJ — "a esta clienta le doy 45%" —
 *     y congelaba la línea entera, así que esa cotización dejaba de recibir los
 *     precios de la tienda. Ahora se marca aparte con `discountOverridden`
 *     (ver `edito el descuento`) y el catálogo sigue actualizando la lista.
 *   - El nombre, el detalle, la marca, el link y la FOTO. No tienen nada que
 *     ver con el precio. MJ tenía 14 líneas congeladas por esto, la mayoría por
 *     aceptar una foto que ni siquiera había cambiado (ver mismaImagen.ts).
 *
 * Cambiar cantidad / ambiente / orden nunca contó y sigue sin contar.
 */
export function editoCampoDeCatalogo(
  prev: PrevLineaPrecio,
  inc: IncomingLineaPrecio
): boolean {
  if (dif(prev.listPrice, inc.listPrice)) return true;
  // El precio a cliente se mueve solo cuando cambia la lista o el descuento. Si
  // cambió sin que ninguno de los dos se moviera, es que MJ lo escribió a mano.
  const dctoIgual = !dif(prev.discountPercent ?? 0, inc.discountPercent);
  return dctoIgual && dif(prev.clientPrice, inc.clientPrice);
}

/**
 * ¿MJ cambió el porcentaje de descuento? Entonces ese número pasa a ser suyo:
 * el catálogo puede seguir actualizando el precio de lista, pero no este
 * porcentaje. No despega la línea — es justo lo que se buscaba separar.
 */
export function editoElDescuento(
  prev: PrevLineaPrecio,
  inc: IncomingLineaPrecio
): boolean {
  return dif(prev.discountPercent ?? 0, inc.discountPercent);
}
