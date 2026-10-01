/**
 * "Aplicar" del modal "Comparar con la tienda web" de una partida de herrajes
 * (pendiente 143, 2026-09-29).
 *
 * POST /api/presupuestos/{id}/muebles/items/{itemId}/herrajes/aplicar-web
 *   Body: {
 *     lineIds: string[],     // las líneas que MJ MARCÓ, una por una (mismo
 *                            // gesto que artefactos)
 *     cotizacion?: boolean,  // cambiar el costo de esas líneas (default true)
 *     catalogo?: boolean,    // dejar el precio de hoy en el catálogo de
 *                            // herrajes (default false: es una opción que MJ
 *                            // prende, "sí aplicar en el catálogo, dar la opción")
 *     preciosNavegador?: { [catalogId]: number }  // los que leyó el navegador
 *                            // porque la tienda bloquea al servidor (HBT)
 *   }
 *
 * COTIZACIÓN solo en BORRADOR: "no se deben tocar cotizaciones ya enviadas"
 * (MJ). En una enviada / aprobada / rechazada, cambiar la cotización devuelve
 * 409 aunque la pantalla no lo ofrezca — el control vive acá. El CATÁLOGO sí
 * se puede actualizar desde una enviada: no es la cotización, y es justo
 * donde MJ mira los precios (en Los Algarrobos las tres versiones de muebles
 * están enviadas o aprobadas). Actualizar el catálogo NO baja a ninguna
 * cotización: las líneas de herraje tienen el costo congelado.
 *
 * El precio se vuelve a leer de la web acá (mismo lector que "Comparar"),
 * igual que el costo al agregar del catálogo sale del catálogo y no del body:
 * nadie escribe un costo inventado, y si la web cambió entre comparar y
 * aplicar, queda el de ahora. Excepción (2026-10-01): hbt.cl rechaza al
 * servidor, así que para HBT, si acá no se pudo leer, vale el precio que leyó
 * el navegador de MJ en la ventana (precioWebParaAplicar).
 *
 * Solo toca herrajes que se comparan con la web (DPH y HBT con catálogo y
 * link, ver PROVEEDORES_PRECIO_WEB). Las que no se pudieron leer quedan igual.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { fetchHerrajePrice } from "@/lib/catalog/fetchHerrajePrice";
import { recomputeAndPersistHerrajeItem } from "@/lib/presupuesto/muebleHerrajes";
import {
  precioWebParaAplicar,
  seComparaConLaWeb,
} from "@/lib/presupuesto/herrajeProveedores";
import { conLink, linksDelCatalogo } from "@/lib/presupuesto/herrajeLinks";

// Lee varias páginas del proveedor: puede tardar unos segundos.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetId, itemId } = await params;
    const body = await request.json().catch(() => ({}));
    const lineIds: string[] = Array.isArray(body?.lineIds)
      ? body.lineIds.filter((x: unknown): x is string => typeof x === "string")
      : [];
    const aCotizacion = body?.cotizacion !== false;
    const aCatalogo = body?.catalogo === true;
    const preciosNavegador: Record<string, unknown> =
      body?.preciosNavegador && typeof body.preciosNavegador === "object"
        ? body.preciosNavegador
        : {};
    if (lineIds.length === 0 || (!aCotizacion && !aCatalogo)) {
      return NextResponse.json({ error: "No hay nada que aplicar" }, { status: 400 });
    }

    const item = await prisma.muebleItem.findUnique({
      where: { id: itemId },
      select: { budgetVersionId: true, budgetVersion: { select: { status: true } } },
    });
    if (!item || item.budgetVersionId !== budgetId) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    if (aCotizacion && item.budgetVersion.status !== "borrador") {
      return NextResponse.json(
        { error: "Esta cotización ya se envió: sus precios no se cambian." },
        { status: 409 },
      );
    }

    const lineas = await prisma.muebleHerraje.findMany({
      where: { itemId, id: { in: lineIds } },
    });
    const catIds = lineas.map((l) => l.catalogId).filter((x): x is string => !!x);
    const cats = await prisma.herrajeCatalog.findMany({
      where: { id: { in: catIds } },
      select: { id: true, supplier: true, referenceLink: true, sku: true, costNet: true },
    });
    const catPorId = new Map(cats.map((c) => [c.id, c]));

    // Un herraje del catálogo puede estar en dos líneas: la web se lee una
    // vez por herraje, no por línea.
    const webPorCatalogo = new Map<string, number | null>();
    await Promise.all(
      [...new Set(lineas.map((l) => l.catalogId).filter((x): x is string => !!x))].map(
        async (cid) => {
          const cat = catPorId.get(cid);
          if (!cat?.referenceLink || !seComparaConLaWeb(cat.supplier)) return;
          try {
            const { costNet } = await fetchHerrajePrice({
              supplier: cat.supplier,
              referenceLink: cat.referenceLink,
              sku: cat.sku,
            });
            webPorCatalogo.set(
              cid,
              precioWebParaAplicar(cat.supplier, costNet, preciosNavegador[cid]),
            );
          } catch {
            webPorCatalogo.set(
              cid,
              precioWebParaAplicar(cat.supplier, null, preciosNavegador[cid]),
            );
          }
        },
      ),
    );

    let noAplica = 0;
    let sinLeer = 0;
    const lineasACambiar: { id: string; costNet: number }[] = [];
    const catalogoACambiar = new Map<string, number>();
    for (const l of lineas) {
      const cat = l.catalogId ? catPorId.get(l.catalogId) : undefined;
      if (!cat || !webPorCatalogo.has(cat.id) || !seComparaConLaWeb(l.supplier)) {
        noAplica++;
        continue;
      }
      const web = webPorCatalogo.get(cat.id);
      if (web == null) {
        sinLeer++;
        continue;
      }
      if (aCotizacion && Math.abs(web - l.costNet) >= 1) {
        lineasACambiar.push({ id: l.id, costNet: web });
      }
      if (aCatalogo && Math.abs(web - cat.costNet) >= 1) {
        catalogoACambiar.set(cat.id, web);
      }
    }

    const ahora = new Date();
    await prisma.$transaction([
      ...lineasACambiar.map((r) =>
        prisma.muebleHerraje.update({ where: { id: r.id }, data: { costNet: r.costNet } }),
      ),
      // Mismo efecto que el PUT del catálogo al cambiar el costo: costo nuevo
      // y fecha de la última revisión. clientPrice no se toca (null = costo
      // × 1,2; si MJ fijó uno a mano, se respeta).
      ...[...catalogoACambiar].map(([id, costNet]) =>
        prisma.herrajeCatalog.update({
          where: { id },
          data: { costNet, lastPriceCheck: ahora },
        }),
      ),
    ]);
    const updatedItem =
      lineasACambiar.length > 0 ? await recomputeAndPersistHerrajeItem(itemId) : null;

    // Todas las líneas de la partida, con su ↗, para que el editor reemplace
    // su estado sin recargar.
    const todas = await prisma.muebleHerraje.findMany({
      where: { itemId },
      orderBy: { sortOrder: "asc" },
    });
    const links = await linksDelCatalogo(todas.map((h) => h.catalogId));

    return NextResponse.json({
      lines: todas.map((h) => conLink(h, links)),
      item: updatedItem,
      resumen: {
        lineas: lineasACambiar.length,
        catalogo: catalogoACambiar.size,
        sinLeer,
        noAplica,
      },
    });
  } catch (error) {
    console.error("Error aplicando precios de la web a herrajes:", error);
    return NextResponse.json(
      { error: "Error al aplicar precios de la web" },
      { status: 500 },
    );
  }
}
