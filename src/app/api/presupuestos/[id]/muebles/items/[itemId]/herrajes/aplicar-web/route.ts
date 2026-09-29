/**
 * "Aplicar cambios marcados" del modal "Comparar con la tienda web" de una
 * partida de herrajes (pendiente 143, 2026-09-29).
 *
 * POST /api/presupuestos/{id}/muebles/items/{itemId}/herrajes/aplicar-web
 *   Body: { lineIds: string[] } — las líneas que MJ MARCÓ, una por una, en el
 *   modal (mismo gesto que artefactos). Se recalcula la partida una sola vez.
 *
 * Solo en BORRADOR: "no se deben tocar cotizaciones ya enviadas" (MJ). Una
 * enviada / aprobada / rechazada devuelve 409 aunque la pantalla no ofrezca
 * el botón — el control vive acá, no solo en la pantalla.
 *
 * El precio NO viene del cliente: se vuelve a leer de la web acá (mismo
 * lector que "Comparar con la web"), igual que el costo al agregar del
 * catálogo sale del catálogo y no del body. Así nadie puede escribir un costo
 * inventado, y si la web cambió entre comparar y aplicar, queda el de ahora.
 *
 * Solo toca líneas que se comparan con la web (DPH con catálogo y link, ver
 * PROVEEDORES_PRECIO_WEB): una línea HBT que llegue en la lista se ignora —
 * su costo es el precio negociado. Las que no se pudieron leer quedan igual.
 * No toca el catálogo: solo el costo de estas líneas de esta cotización.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { fetchHerrajePrice } from "@/lib/catalog/fetchHerrajePrice";
import { recomputeAndPersistHerrajeItem } from "@/lib/presupuesto/muebleHerrajes";
import { seComparaConLaWeb } from "@/lib/presupuesto/herrajeProveedores";
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
    if (lineIds.length === 0) {
      return NextResponse.json({ error: "Faltan las líneas a aplicar" }, { status: 400 });
    }

    const item = await prisma.muebleItem.findUnique({
      where: { id: itemId },
      select: { budgetVersionId: true, budgetVersion: { select: { status: true } } },
    });
    if (!item || item.budgetVersionId !== budgetId) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    if (item.budgetVersion.status !== "borrador") {
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
      select: { id: true, supplier: true, referenceLink: true, sku: true },
    });
    const catPorId = new Map(cats.map((c) => [c.id, c]));

    const resultados = await Promise.all(
      lineas.map(async (l) => {
        const cat = l.catalogId ? catPorId.get(l.catalogId) : undefined;
        if (
          !cat?.referenceLink ||
          !seComparaConLaWeb(l.supplier) ||
          !seComparaConLaWeb(cat.supplier)
        ) {
          return { id: l.id, estado: "no-aplica" as const };
        }
        try {
          const { costNet: web } = await fetchHerrajePrice({
            supplier: cat.supplier,
            referenceLink: cat.referenceLink,
            sku: cat.sku,
          });
          if (web == null) return { id: l.id, estado: "sin-leer" as const };
          if (Math.abs(web - l.costNet) < 1) return { id: l.id, estado: "ya-calzaba" as const };
          return { id: l.id, estado: "aplicar" as const, costNet: web };
        } catch {
          return { id: l.id, estado: "sin-leer" as const };
        }
      }),
    );

    const aAplicar = resultados.filter(
      (r): r is { id: string; estado: "aplicar"; costNet: number } => r.estado === "aplicar",
    );
    if (aAplicar.length > 0) {
      await prisma.$transaction(
        aAplicar.map((r) =>
          prisma.muebleHerraje.update({
            where: { id: r.id },
            data: { costNet: r.costNet },
          }),
        ),
      );
    }
    const updatedItem = await recomputeAndPersistHerrajeItem(itemId);

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
        aplicadas: aAplicar.length,
        sinLeer: resultados.filter((r) => r.estado === "sin-leer").length,
        yaCalzaban: resultados.filter((r) => r.estado === "ya-calzaba").length,
        noAplica: resultados.filter((r) => r.estado === "no-aplica").length,
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
