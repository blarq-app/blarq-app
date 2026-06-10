/**
 * "Revisar precios" del catálogo de artefactos.
 *
 * POST /api/catalogo/artefactos/revisar-precios
 *   Body opcional: { subcategory?: string } para acotar a una pestaña.
 *
 * Para cada artefacto CON link trae el precio de hoy de la web:
 *   - mk.cl (VTEX): vía API de catálogo → ListPrice (lista) + Price (con dcto).
 *     De ahí sale el descuento del web automáticamente.
 *   - otras tiendas: scraping liviano (fetchArtefactoData) → solo precio, dcto 0.
 *
 * NO pisa nada: devuelve la comparación guardado-vs-web (lista, dcto y total)
 * para que MJ decida cuáles aplicar. La aplicación se hace con el PUT por id.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { fetchArtefactoData } from "@/lib/catalog/fetchArtefactoData";
import { fetchMkVtexPrice, isMkUrl } from "@/lib/catalog/fetchMkPrice";

// Vercel: el fetch a la web puede tardar; subimos el límite de la función
// para que no se corte (default 10s) mientras consulta varios productos.
export const runtime = "nodejs";
export const maxDuration = 60;

interface RevisionRow {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  referenceLink: string;
  // Lo guardado hoy en el catálogo:
  storedListPrice: number;
  storedDiscount: number; // decimal 0..1
  storedTotal: number; // lo que paga el cliente hoy
  // Lo que trae la web ahora:
  webListPrice: number | null; // precio lista del web
  webDiscount: number | null; // descuento del web (decimal 0..1)
  webTotal: number | null; // lo que pagaría el cliente con el web de hoy
  delta: number | null; // webTotal - storedTotal
  status: "ok" | "sin-precio" | "error";
}

function total(listPrice: number, discount: number): number {
  return Math.round(listPrice * (1 - discount));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const subcategory: string | undefined = body?.subcategory;

    const items = await prisma.artefactoCatalog.findMany({
      where: {
        referenceLink: { not: null },
        ...(subcategory ? { subcategory } : {}),
      },
      select: {
        id: true,
        name: true,
        detail: true,
        brand: true,
        referenceLink: true,
        listPrice: true,
        discountPercent: true,
      },
    });

    const rows: RevisionRow[] = await Promise.all(
      items.map(async (it): Promise<RevisionRow> => {
        const link = it.referenceLink as string;
        const storedDiscount = it.discountPercent ?? 0;
        const base = {
          id: it.id,
          name: it.name,
          detail: it.detail,
          brand: it.brand,
          referenceLink: link,
          storedListPrice: it.listPrice,
          storedDiscount,
          storedTotal: total(it.listPrice, storedDiscount),
        };
        try {
          let webListPrice: number | null = null;
          let webPrice: number | null = null; // precio de venta (con dcto)
          if (isMkUrl(link)) {
            const mk = await fetchMkVtexPrice(link);
            if (mk) {
              webListPrice = mk.listPrice;
              webPrice = mk.price;
            }
          } else {
            const data = await fetchArtefactoData(link);
            if (data?.listPrice != null) {
              // Sin API de descuento: tomamos el precio como lista, dcto 0.
              webListPrice = data.listPrice;
              webPrice = data.listPrice;
            }
          }
          if (webListPrice == null || webPrice == null) {
            return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, status: "sin-precio" };
          }
          const webDiscount =
            webListPrice > 0 ? Math.max(0, 1 - webPrice / webListPrice) : 0;
          return {
            ...base,
            webListPrice,
            webDiscount,
            webTotal: webPrice,
            delta: webPrice - base.storedTotal,
            status: "ok",
          };
        } catch {
          return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, status: "error" };
        }
      })
    );

    // Primero los que más cambiaron; al final los no leídos.
    rows.sort((a, b) => {
      const da = a.delta == null ? -1 : Math.abs(a.delta);
      const db = b.delta == null ? -1 : Math.abs(b.delta);
      return db - da;
    });

    const conLink = items.length;
    const cambiaron = rows.filter((r) => r.delta != null && r.delta !== 0).length;
    const noLeidos = rows.filter((r) => r.status !== "ok").length;

    return NextResponse.json({ rows, resumen: { conLink, cambiaron, noLeidos } });
  } catch (error) {
    console.error("Error revisando precios de artefactos:", error);
    return NextResponse.json(
      { error: "Error al revisar precios" },
      { status: 500 }
    );
  }
}
