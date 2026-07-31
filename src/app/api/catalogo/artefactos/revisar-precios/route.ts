/**
 * "Revisar precios" del catálogo de artefactos.
 *
 * POST /api/catalogo/artefactos/revisar-precios
 *   Body opcional para acotar qué se revisa:
 *     - { ids?: string[] }: revisa SOLO esos artefactos. Es lo que manda la
 *       pantalla para respetar lo que MJ tiene filtrado (pestaña + buscador +
 *       chips de tipo/línea/color). Si viene un arreglo vacío, no revisa nada.
 *     - { subcategory?: string }: acota a una pestaña (compat; se usa si NO
 *       vienen ids).
 *   Sin body (o sin ninguno de los dos): revisa TODOS los que tengan link.
 *
 * Para cada artefacto CON link trae el precio de hoy de la web con la lectura
 * ÚNICA de `leerPrecioWeb` (VTEX / Shopify / scraper genérico — ver ese
 * archivo). En las tiendas sin API el descuento no se puede saber: esas filas
 * vienen con `discountKnown: false` y al aplicar NO pisan el descuento
 * guardado (antes lo mandaban a 0 en silencio).
 *
 * NO pisa nada: devuelve la comparación guardado-vs-web (lista, dcto y total)
 * para que MJ decida cuáles aplicar. La aplicación se hace con el PUT por id.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { leerPrecioWeb } from "@/lib/catalog/leerPrecioWeb";
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
  // ¿La tienda publica lista Y precio de venta? false = tienda sin API (el
  // número leído puede ser una oferta disfrazada de lista): al aplicar NO se
  // pisa el descuento ya guardado. Ver leerPrecioWeb.ts.
  discountKnown: boolean;
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
    // La pantalla manda los ids de lo que está a la vista (ya filtrado por
    // pestaña + buscador + chips). Si viene el arreglo (aunque sea vacío)
    // manda; si no viene, caemos a subcategory o a "todos".
    const ids: string[] | undefined = Array.isArray(body?.ids)
      ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;

    const items = await prisma.artefactoCatalog.findMany({
      where: {
        referenceLink: { not: null },
        ...(ids ? { id: { in: ids } } : subcategory ? { subcategory } : {}),
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
          // Lectura única para todas las tiendas (ver leerPrecioWeb.ts).
          const web = await leerPrecioWeb(link);
          if (!web) {
            return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, discountKnown: false, changed: false, status: "sin-precio" };
          }
          const { listPrice: webListPrice, salePrice: webPrice, discount: webDiscount } = web;
          // Cambió si difiere la lista, el descuento O el total (no solo el
          // total — ver comentario en RevisionRow.changed).
          // Si el descuento no es confiable (tienda sin API), no lo usamos
          // como señal de cambio ni se aplicará: solo miramos la lista.
          const changed = web.discountKnown
            ? Math.abs(webListPrice - base.storedListPrice) > EPS_PESO ||
              Math.abs(webDiscount - base.storedDiscount) > EPS_DCTO ||
              Math.abs(webPrice - base.storedTotal) > EPS_PESO
            : Math.abs(webListPrice - base.storedListPrice) > EPS_PESO;
          return {
            ...base,
            webListPrice,
            webDiscount,
            webTotal: webPrice,
            delta: webPrice - base.storedTotal,
            discountKnown: web.discountKnown,
            changed,
            status: "ok",
          };
        } catch {
          return { ...base, webListPrice: null, webDiscount: null, webTotal: null, delta: null, discountKnown: false, changed: false, status: "error" };
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
