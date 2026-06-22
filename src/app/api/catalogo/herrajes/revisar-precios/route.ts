/**
 * "Revisar precios" del catálogo de herrajes.
 *
 * POST /api/catalogo/herrajes/revisar-precios
 *   Body opcional: { ids?: string[], supplier?: string } para acotar.
 *
 * Para cada herraje CON link trae el COSTO de hoy desde el proveedor:
 *   - DPH (Shopify): variante por SKU vía <producto>.json (ver fetchHerrajePrice).
 *   - HBT (Magento): pendiente — devuelve "sin-precio" sin romperse.
 *
 * NO pisa nada: devuelve costo guardado vs costo web para que MJ aplique los
 * que quiera (la aplicación se hace con el PUT por id, seteando costNet).
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { fetchHerrajePrice } from "@/lib/catalog/fetchHerrajePrice";
import { requireSession } from "@/lib/apiAuth";

// El fetch a la web puede tardar al consultar varios productos.
export const runtime = "nodejs";
export const maxDuration = 60;

interface RevisionRow {
  id: string;
  name: string;
  supplier: string;
  referenceLink: string;
  storedCost: number; // costo neto guardado hoy
  webCost: number | null; // costo de hoy en el proveedor
  delta: number | null; // webCost - storedCost
  status: "ok" | "sin-precio" | "error";
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const body = await request.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body?.ids)
      ? body.ids
      : undefined;
    const supplier: string | undefined = body?.supplier;

    const items = await prisma.herrajeCatalog.findMany({
      where: {
        referenceLink: { not: null },
        ...(ids ? { id: { in: ids } } : {}),
        ...(supplier ? { supplier } : {}),
      },
      select: {
        id: true,
        name: true,
        supplier: true,
        referenceLink: true,
        sku: true,
        costNet: true,
      },
    });

    const rows: RevisionRow[] = await Promise.all(
      items.map(async (it): Promise<RevisionRow> => {
        const link = it.referenceLink as string;
        const base = {
          id: it.id,
          name: it.name,
          supplier: it.supplier,
          referenceLink: link,
          storedCost: it.costNet,
        };
        try {
          const { costNet: webCost } = await fetchHerrajePrice({
            supplier: it.supplier,
            referenceLink: link,
            sku: it.sku,
          });
          if (webCost == null) {
            return { ...base, webCost: null, delta: null, status: "sin-precio" };
          }
          return {
            ...base,
            webCost,
            delta: webCost - base.storedCost,
            status: "ok",
          };
        } catch {
          return { ...base, webCost: null, delta: null, status: "error" };
        }
      }),
    );

    // Primero los que más cambiaron; al final los no leídos.
    rows.sort((a, b) => {
      const da = a.delta == null ? -1 : Math.abs(a.delta);
      const db = b.delta == null ? -1 : Math.abs(b.delta);
      return db - da;
    });

    const summary = {
      ok: rows.filter((r) => r.status === "ok").length,
      changed: rows.filter((r) => r.delta != null && r.delta !== 0).length,
      sinPrecio: rows.filter((r) => r.status === "sin-precio").length,
      error: rows.filter((r) => r.status === "error").length,
    };

    return NextResponse.json({ rows, summary });
  } catch (error) {
    console.error("Error revisando precios de herrajes:", error);
    return NextResponse.json({ error: "Error al revisar precios" }, { status: 500 });
  }
}
