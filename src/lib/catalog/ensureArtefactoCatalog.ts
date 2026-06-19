/**
 * Catálogo BLARQ de artefactos — construcción automática.
 *
 * La idea original (pedido de MJ 2026-05-16): el catálogo de artefactos NO es
 * una lista curada de "los más usados"; se va armando con los productos que se
 * cargan, igual que el listado de materiales.
 *
 * Cambio 2026-06-19: el alta dentro de una cotización dejó de promover TODO
 * automáticamente. Ahora MJ elige por artefacto: "solo en este proyecto"
 * (default, no toca el catálogo) o "desplegar al catálogo" (recién ahí se llama
 * a esta función). La importación masiva desde Excel sí sigue usándola siempre.
 *
 * `ensureArtefactoCatalog` recibe los datos de un artefacto y devuelve el
 * id de su entrada en el catálogo:
 *   - Si ya existe una entrada con el mismo nombre (case-insensitive), la
 *     reutiliza — no duplica.
 *   - Si no existe, la crea.
 */

import type { Prisma } from "@prisma/client";

// Acepta el cliente normal o el de una transacción interactiva.
type DbClient = Prisma.TransactionClient;

export interface ArtefactoCatalogInput {
  name: string;
  detail?: string | null;
  brand?: string | null;
  subcategory?: string | null;
  referenceLink?: string | null;
  imageUrl?: string | null;
  listPrice?: number | null;
  discountPercent?: number | null;
  // Línea comercial y color/terminación. Cuando MJ despliega al catálogo un
  // artefacto creado en una cotización, los manda para que la entrada nazca ya
  // agrupable por línea+color (no haya que recategorizar después).
  line?: string | null;
  finish?: string | null;
  supplier?: string | null;
}

export async function ensureArtefactoCatalog(
  db: DbClient,
  data: ArtefactoCatalogInput
): Promise<string | null> {
  const nombre = data.name?.trim();
  if (!nombre) return null;

  // ¿Ya está en el catálogo? Match por nombre, sin distinguir mayúsculas.
  const existing = await db.artefactoCatalog.findFirst({
    where: { name: { equals: nombre, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const listPrice = data.listPrice ?? 0;
  const created = await db.artefactoCatalog.create({
    data: {
      name: nombre,
      detail: data.detail ?? null,
      brand: data.brand ?? null,
      subcategory: data.subcategory ?? "sanitario",
      referenceLink: data.referenceLink ?? null,
      imageUrl: data.imageUrl ?? null,
      line: data.line ?? null,
      finish: data.finish ?? null,
      supplier: data.supplier ?? null,
      listPrice,
      discountPercent: data.discountPercent ?? null,
      // No es "estándar" automáticamente — eso lo marca MJ con la ★.
      isStandard: false,
      lastPriceCheck: listPrice > 0 ? new Date() : null,
    },
    select: { id: true },
  });
  return created.id;
}
