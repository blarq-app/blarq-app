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
 */
export async function propagateCatalogToBorradores(
  catalogId: string,
  cat: CatalogArtefactoData
): Promise<number> {
  const descuento = cat.discountPercent ?? null;
  const clientPrice = cat.listPrice * (1 - (descuento ?? 0));
  const res = await prisma.artefactoItem.updateMany({
    where: {
      catalogId,
      priceOverridden: false,
      budgetVersion: { status: "borrador" },
    },
    data: {
      name: cat.name,
      detail: cat.detail,
      brand: cat.brand,
      listPrice: cat.listPrice,
      discountPercent: descuento,
      clientPrice,
      referenceLink: cat.referenceLink,
      imageUrl: cat.imageUrl,
    },
  });
  return res.count;
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

/**
 * ¿La edición tocó algún campo que viene del catálogo? Si sí, la línea debe
 * "despegarse" (priceOverridden=true) para que el catálogo no la vuelva a
 * pisar. Cambiar solo cantidad / ambiente / orden NO cuenta (no se comparan
 * acá). Comparamos contra el valor guardado porque el editor manda la fila
 * completa en cada guardado y no sabríamos qué cambió.
 */
export function editoCampoDeCatalogo(
  prev: PrevLineaPrecio,
  inc: IncomingLineaPrecio
): boolean {
  const dif = (a: number, b: number) => Math.abs(a - b) > 0.01;
  return (
    dif(prev.listPrice, inc.listPrice) ||
    dif(prev.discountPercent ?? 0, inc.discountPercent) ||
    dif(prev.clientPrice, inc.clientPrice) ||
    (prev.name ?? "") !== (inc.name ?? "") ||
    (prev.detail ?? null) !== (inc.detail ?? null) ||
    (prev.brand ?? null) !== (inc.brand ?? null) ||
    (prev.referenceLink ?? null) !== (inc.referenceLink ?? null) ||
    (prev.imageUrl ?? null) !== (inc.imageUrl ?? null)
  );
}
