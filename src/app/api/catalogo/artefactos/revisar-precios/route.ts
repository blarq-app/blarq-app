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
 * NO pisa el precio: devuelve la comparación guardado-vs-web (lista, dcto y
 * total) para que MJ decida cuáles aplicar. La aplicación se hace con el PUT
 * por id.
 *
 * Lo único que SÍ escribe (desde 2026-08-02) son los campos de REFERENCIA
 * `web*`: qué decía la tienda y cuándo. No entran en ningún cálculo de precio;
 * existen para que un producto nunca se quede sin dato de internet. Se guardan
 * al MIRAR, no al aplicar, porque si no el dato se perdería justo cuando MJ
 * decide no aplicar nada. Cuando el link no responde se registra desde cuándo,
 * conservando la última lectura buena: MK da de baja los productos sin stock y
 * los repone, así que "no se pudo leer" no significa "link roto".
 *
 * Desde 2026-08-05 también REPARA LA FOTO (pendiente 132). El catálogo guarda
 * el link a la foto que vive en el servidor del proveedor, y ese link muere
 * cuando la tienda reemplaza la imagen: queda el recuadro vacío aunque el campo
 * tenga dato. Como acá ya estamos visitando el producto, se aprovecha el viaje:
 *   - se prueba la foto guardada (HEAD, en paralelo con el precio: no alarga la
 *     revisión),
 *   - SOLO si no carga (o no hay ninguna) se pide la que la tienda publica hoy.
 * Si la foto guardada carga, no se toca: así no se pisan las fotos que MJ subió
 * a mano (las embebidas `data:` se dan por vivas siempre). Es una reparación,
 * no una sincronización.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { leerPrecioWeb } from "@/lib/catalog/leerPrecioWeb";
import { leerFotoWeb, fotoSigueViva } from "@/lib/catalog/leerFotoWeb";
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
  // Cuando no se pudo leer: qué decía la tienda la última vez que sí se pudo, y
  // desde cuándo está ilegible. Sirve para no dejar al producto sin ninguna
  // referencia de internet mientras está de baja.
  ultimaLecturaBuena?: { listPrice: number | null; salePrice: number | null; cuando: Date } | null;
  sinLeerDesde?: Date | null;
  // ¿Se repuso la foto en esta pasada porque la guardada ya no cargaba? Es
  // informativo: la foto se arregla sola, no hay nada que "aplicar".
  fotoReparada?: boolean;
}

/**
 * Repone la foto del artefacto si la que tiene guardada ya no carga.
 *
 * Se hace acá y no en un botón aparte porque "Revisar precios" ya está yendo a
 * la página del producto. El chequeo es un HEAD (no baja la imagen) y corre en
 * paralelo con la lectura del precio, así que no alarga la revisión; el pedido
 * de la foto nueva solo ocurre para las que están rotas, que son unas pocas.
 *
 * Devuelve la foto nueva si la repuso, o null si no hizo falta (o si la tienda
 * tampoco publica una que cargue: en ese caso se deja la guardada como está,
 * para que quede el rastro de que alguna vez tuvo).
 */
async function repararFoto(it: {
  id: string;
  imageUrl: string | null;
  referenceLink: string | null;
}): Promise<string | null> {
  if (!it.referenceLink) return null;
  if (await fotoSigueViva(it.imageUrl)) return null;
  const nueva = await leerFotoWeb(it.referenceLink);
  if (!nueva || nueva === it.imageUrl) return null;
  await prisma.artefactoCatalog
    .update({ where: { id: it.id }, data: { imageUrl: nueva } })
    .catch(() => {});
  return nueva;
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
        imageUrl: true,
        webListPrice: true,
        webSalePrice: true,
        webCheckedAt: true,
        webUnreadableSince: true,
      },
    });

    const rows: RevisionRow[] = await Promise.all(
      items.map(async (it): Promise<RevisionRow> => {
        // La foto se revisa en paralelo con el precio (ver repararFoto): son
        // dos viajes independientes, no se esperan entre sí.
        const foto = repararFoto(it);
        const row = await revisarPrecio(it);
        return { ...row, fotoReparada: (await foto) != null };
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
    const fotosReparadas = rows.filter((r) => r.fotoReparada).length;

    return NextResponse.json({
      rows,
      resumen: { conLink, cambiaron, noLeidos, fotosReparadas },
    });
  } catch (error) {
    console.error("Error revisando precios de artefactos:", error);
    return NextResponse.json(
      { error: "Error al revisar precios" },
      { status: 500 }
    );
  }
}

// Comparación guardado-vs-web de UN artefacto (lo de siempre; se separó en su
// propia función para poder revisar la foto en paralelo).
async function revisarPrecio(it: {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  referenceLink: string | null;
  listPrice: number;
  discountPercent: number | null;
  webListPrice: number | null;
  webSalePrice: number | null;
  webCheckedAt: Date | null;
  webUnreadableSince: Date | null;
}): Promise<RevisionRow> {
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
      // No se pudo leer: se anota desde cuándo (si no estaba anotado ya)
      // y se conserva la última lectura buena.
      if (!it.webUnreadableSince) {
        await prisma.artefactoCatalog
          .update({ where: { id: it.id }, data: { webUnreadableSince: new Date() } })
          .catch(() => {});
      }
      return {
        ...base,
        webListPrice: null, webDiscount: null, webTotal: null, delta: null,
        discountKnown: false, changed: false, status: "sin-precio",
        ultimaLecturaBuena: it.webCheckedAt
          ? { listPrice: it.webListPrice, salePrice: it.webSalePrice, cuando: it.webCheckedAt }
          : null,
        sinLeerDesde: it.webUnreadableSince ?? new Date(),
      };
    }
    // Lectura buena: se guarda como referencia y se limpia la marca de
    // ilegible (el producto volvió).
    await prisma.artefactoCatalog
      .update({
        where: { id: it.id },
        data: {
          webListPrice: web.listPrice,
          webSalePrice: web.salePrice,
          webCheckedAt: new Date(),
          webUnreadableSince: null,
        },
      })
      .catch(() => {});
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
    return {
      ...base,
      webListPrice: null, webDiscount: null, webTotal: null, delta: null,
      discountKnown: false, changed: false, status: "error",
      ultimaLecturaBuena: it.webCheckedAt
        ? { listPrice: it.webListPrice, salePrice: it.webSalePrice, cuando: it.webCheckedAt }
        : null,
      sinLeerDesde: it.webUnreadableSince,
    };
  }
}
