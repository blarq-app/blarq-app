/**
 * "Revisar precios" del catálogo de artefactos.
 *
 * POST /api/catalogo/artefactos/revisar-precios
 *   Body opcional: { subcategory?: string } para acotar a una pestaña.
 *
 * Para cada artefacto CON link, va a la web (scraping liviano vía
 * fetchArtefactoData — mk.cl / sodimac / easy) y trae el precio de hoy.
 * NO pisa nada: solo devuelve la comparación guardado-vs-web para que MJ
 * decida cuáles aplicar. La aplicación se hace después con el PUT por id.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { fetchArtefactoData } from "@/lib/catalog/fetchArtefactoData";

interface RevisionRow {
  id: string;
  name: string;
  referenceLink: string;
  storedListPrice: number; // precio web guardado hoy en el catálogo
  webPrice: number | null; // precio que trae la web ahora
  delta: number | null; // webPrice - storedListPrice (null si no se pudo)
  status: "ok" | "sin-precio" | "error";
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
      select: { id: true, name: true, referenceLink: true, listPrice: true },
    });

    // Scraping en paralelo, tolerante a fallas (una tienda lenta no tumba
    // al resto). allSettled + por item resolvemos status.
    const rows: RevisionRow[] = await Promise.all(
      items.map(async (it): Promise<RevisionRow> => {
        const link = it.referenceLink as string;
        try {
          const data = await fetchArtefactoData(link);
          const webPrice = data?.listPrice ?? null;
          if (webPrice == null) {
            return {
              id: it.id,
              name: it.name,
              referenceLink: link,
              storedListPrice: it.listPrice,
              webPrice: null,
              delta: null,
              status: "sin-precio",
            };
          }
          return {
            id: it.id,
            name: it.name,
            referenceLink: link,
            storedListPrice: it.listPrice,
            webPrice,
            delta: webPrice - it.listPrice,
            status: "ok",
          };
        } catch {
          return {
            id: it.id,
            name: it.name,
            referenceLink: link,
            storedListPrice: it.listPrice,
            webPrice: null,
            delta: null,
            status: "error",
          };
        }
      })
    );

    // Orden: primero los que cambiaron (mayor diferencia absoluta), después
    // los iguales, al final los que no se pudieron leer.
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
