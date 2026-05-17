/**
 * Catálogo BLARQ de artefactos — construcción automática.
 *
 * La idea (pedido de MJ 2026-05-16): el catálogo de artefactos NO es una
 * lista curada de "los más usados". Se construye solo, con CADA producto
 * que se agrega a cualquier cotización — igual que el listado de
 * materiales. La lista termina siendo grande y cubre toda la variedad.
 *
 * `ensureArtefactoCatalog` recibe los datos de un artefacto y devuelve el
 * id de su entrada en el catálogo:
 *   - Si ya existe una entrada con el mismo nombre (case-insensitive), la
 *     reutiliza — no duplica.
 *   - Si no existe, la crea.
 *
 * Sirve tanto para el alta individual (POST de artefactos) como para la
 * importación masiva desde Excel.
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
