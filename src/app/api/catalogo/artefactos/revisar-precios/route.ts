/**
 * "Revisar precios" del catálogo de artefactos.
 *
 * POST /api/catalogo/artefactos/revisar-precios
 *   Body opcional: { subcategory?: string } para acotar a una pestaña.
 *
 * Para cada artefacto CON link trae el precio de hoy de la web:
 *   - tiendas VTEX (mk.cl, ledstudio.cl): vía API de catálogo → ListPrice
 *     (lista) + Price (con dcto). De ahí sale el descuento del web solo.
 *   - otras tiendas: scraping liviano (fetchArtefactoData) → solo precio, dcto 0.
 *
 * NO pisa nada: devuelve la comparación guardado-vs-web (lista, dcto y total)
 * para que MJ decida cuáles aplicar. La aplicación se hace con el PUT por id.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { fetchArtefactoData } from "@/lib/catalog/fetchArtefactoData";
import { fetchVtexPrice, isVtexStoreUrl } from "@/lib/catalog/fetchVtexPrice";
import { requireSession } from "@/lib/apiAuth";

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
  // ¿Hay algo que aplicar? Verdadero si la web difiere de lo guardado en
  // lista, descuento O total. OJO: NO alcanza con mirar el total — un producto
  // que la web pone en oferta (lista $53.290 −25% = $39.990) puede tener el
  // mismo total que el catálogo cuando éste guardó el precio con descuento ya
  // aplicado y 0% (lista $39.990, 0%). El total no cambia pero la lista y el
  // descuento sí, y eso es justo lo que hay que bajar para que se vea el dcto.
  changed: boolean;
  status: "ok" | "sin-precio" | "error";
}

function total(listPrice: number, discount: number): number {
  return Math.round(listPrice * (1 - discount));
}

// Tolerancias para comparar guardado vs web (evita falsos cambios por
// redondeo): 1 peso en montos, 0,5% en el descuento decimal.
const EPS_PESO = 1;
const EPS_DCTO = 0.005;

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
          if (isVtexStoreUrl(link)) {
            const vtex = await fetchVtexPrice(link);
            if (vtex) {
              webListPrice = vtex.listPrice;
              webPrice = vtex.price;
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
            return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, changed: false, status: "sin-precio" };
          }
          const webDiscount =
            webListPrice > 0 ? Math.max(0, 1 - webPrice / webListPrice) : 0;
          // Cambió si difiere la lista, el descuento O el total (no solo el
          // total — ver comentario en RevisionRow.changed).
          const changed =
            Math.abs(webListPrice - base.storedListPrice) > EPS_PESO ||
            Math.abs(webDiscount - base.storedDiscount) > EPS_DCTO ||
            Math.abs(webPrice - base.storedTotal) > EPS_PESO;
          return {
            ...base,
            webListPrice,
            webDiscount,
            webTotal: webPrice,
            delta: webPrice - base.storedTotal,
            changed,
            status: "ok",
          };
        } catch {
          return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, changed: false, status: "error" };
        }
      })
    );

    // Primero los que tienen algo que aplicar; dentro, los que más movieron el
    // total; al final los no leídos.
    rows.sort((a, b) => {
      if (a.changed !== b.changed) return a.changed ? -1 : 1;
      const da = a.delta == null ? -1 : Math.abs(a.delta);
      const db = b.delta == null ? -1 : Math.abs(b.delta);
      return db - da;
    });

    const conLink = items.length;
    const cambiaron = rows.filter((r) => r.changed).length;
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
