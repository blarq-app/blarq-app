/**
 * Link del producto (la flechita ↗) de cada línea de herraje de una partida.
 *
 * La línea (MuebleHerraje) NO guarda el link: guarda `catalogId`, y el link
 * vive en el catálogo (HerrajeCatalog.referenceLink). No hay relación de
 * Prisma entre los dos (el catalogId es solo trazabilidad y puede apuntar a un
 * herraje ya borrado), así que se busca aparte y se pega a la línea antes de
 * mandarla al editor (pendiente 143, 2026-09-28).
 *
 * Por qué del catálogo y no copiado en la línea: si MJ corrige un link en el
 * catálogo (ej. el proveedor cambió la URL), la flechita de todas las
 * cotizaciones queda al día sola. El costo sí va congelado en la línea; el
 * link no es plata.
 *
 * Las líneas sin catálogo detrás (cargadas a mano, o de un herraje borrado)
 * quedan con `referenceLink: null` y no muestran flechita.
 */
import { prisma } from "@/lib/prisma";

type ConCatalogo = { catalogId: string | null };
export type ConLink<T> = T & { referenceLink: string | null };

// catalogId → link, solo para los herrajes que tienen link cargado. Una sola
// consulta para todas las líneas que se le pasen.
export async function linksDelCatalogo(
  catalogIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(catalogIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const cats = await prisma.herrajeCatalog.findMany({
    where: { id: { in: ids }, referenceLink: { not: null } },
    select: { id: true, referenceLink: true },
  });
  const links = new Map<string, string>();
  for (const c of cats) {
    const link = c.referenceLink?.trim();
    if (link) links.set(c.id, link);
  }
  return links;
}

export function conLink<T extends ConCatalogo>(
  linea: T,
  links: Map<string, string>,
): ConLink<T> {
  return {
    ...linea,
    referenceLink: (linea.catalogId && links.get(linea.catalogId)) || null,
  };
}

// Atajo para las rutas que devuelven partidas enteras (con sus líneas de
// herraje) al editor: les pega el link a todas las líneas de una vez.
export async function itemsConLinkDeHerraje<
  I extends { herrajes: ConCatalogo[] },
>(items: I[]) {
  const links = await linksDelCatalogo(
    items.flatMap((i) => i.herrajes.map((h) => h.catalogId)),
  );
  return items.map((i) => ({
    ...i,
    herrajes: i.herrajes.map((h) =>
      conLink(h as I["herrajes"][number], links),
    ),
  }));
}
