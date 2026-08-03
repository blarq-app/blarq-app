/**
 * CREA un molde nuevo en el Catálogo de Partidas a partir de una partida que
 * MJ armó de cero en una cotización, y deja la partida enganchada a ese molde.
 *
 * Por qué existe: hasta ahora los botones "a catálogo" solo servían para
 * partidas que YA venían del catálogo — `pushObraItemComponentsToCatalog` tira
 * SinCatalogoError si el ObraItem no tiene `catalogPartidaId`. O sea: una
 * partida nueva, con todo su desglose de materiales y mano de obra, se moría en
 * esa cotización y había que rearmarla a mano en el catálogo para reusarla.
 *
 * Qué hace exactamente:
 *   1. Traduce el capítulo de la cotización a la categoría del catálogo
 *      (homologarCategoria — son dos vocabularios distintos).
 *   2. Crea la PartidaCatalog (nombre, unidad, descripciones, precio y los 6
 *      rubros de costo copiados de la partida).
 *   3. Engancha el ObraItem al molde nuevo (catalogPartidaId), así de ahí en
 *      más se comporta igual que una partida que vino del catálogo.
 *   4. Copia el desglose línea por línea reusando
 *      pushObraItemComponentsToCatalog, que ya sabe traducir el puntero de la
 *      pérdida (appliedToComponentId) de ids de cotización a ids de catálogo.
 *
 * Lo que NO hace: no toca ninguna otra cotización, ni los totales de ESTA
 * (crear un molde no mueve un peso del presupuesto; metrics.ts no participa).
 *
 * El GET es el previo: dice si se puede crear y en qué categoría caería, para
 * que el editor muestre el botón solo cuando el guardado va a salir limpio.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { homologarCategoria } from "@/lib/catalog/homologarCategoria";
import { pushObraItemComponentsToCatalog } from "@/lib/catalog/pushObraItemToCatalog";

// Estado de la partida frente al catálogo. Lo comparten el GET (previo) y el
// POST (que lo vuelve a calcular: es el que manda, porque entre que se abrió el
// panel y se apretó el botón MJ pudo haber renombrado la partida).
type Estado =
  | { puede: true; categoria: string; categoriaEsNueva: boolean }
  | {
      puede: false;
      motivo: "ya-tiene-molde" | "nombre-repetido" | "sin-capitulo" | "sin-nombre";
      categoria: string;
      // Molde con el que choca (solo en "nombre-repetido" y "ya-tiene-molde").
      moldeId?: string;
      moldeNombre?: string;
    };

async function evaluar(itemId: string): Promise<Estado | null> {
  const item = await prisma.obraItem.findUnique({
    where: { id: itemId },
    select: {
      name: true,
      catalogPartidaId: true,
      chapter: true,
      chapterRel: { select: { name: true } },
    },
  });
  if (!item) return null;

  // Ya está enganchada: para estas partidas siguen valiendo los botones de
  // siempre ("Editar en catálogo", "↑ Precios a catálogo").
  if (item.catalogPartidaId) {
    const molde = await prisma.partidaCatalog.findUnique({
      where: { id: item.catalogPartidaId },
      select: { id: true, name: true },
    });
    return {
      puede: false,
      motivo: "ya-tiene-molde",
      categoria: "",
      moldeId: molde?.id,
      moldeNombre: molde?.name,
    };
  }

  const nombre = (item.name ?? "").trim();
  if (!nombre) return { puede: false, motivo: "sin-nombre", categoria: "" };

  // El capítulo manda la categoría. `chapterRel` es el capítulo de verdad;
  // `chapter` es la clave legacy de texto, que queda como red por si una
  // partida perdió su capítulo (ver el comentario de ObraItem.chapterId).
  const { categoria, esNueva } = homologarCategoria(
    item.chapterRel?.name ?? item.chapter ?? ""
  );
  if (!categoria) return { puede: false, motivo: "sin-capitulo", categoria: "" };

  // ¿Ya hay un molde con ese nombre en esa categoría? La búsqueda es SIN
  // distinguir mayúsculas a propósito: PartidaCatalog tiene @@unique([category,
  // name]) exacto, así que "Pintura muro" y "PINTURA MURO" convivirían como dos
  // moldes casi idénticos. Para MJ eso es un duplicado igual.
  const repetido = await prisma.partidaCatalog.findFirst({
    where: { category: categoria, name: { equals: nombre, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (repetido) {
    return {
      puede: false,
      motivo: "nombre-repetido",
      categoria,
      moldeId: repetido.id,
      moldeNombre: repetido.name,
    };
  }

  return { puede: true, categoria, categoriaEsNueva: esNueva };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const estado = await evaluar(itemId);
    if (!estado) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    return NextResponse.json(estado);
  } catch (error) {
    console.error("Error evaluando partida para el catálogo:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;

    // Re-evaluar acá y no confiar en lo que vio el front: el nombre de la
    // partida se edita inline y pudo cambiar con el panel abierto.
    const estado = await evaluar(itemId);
    if (!estado) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    if (!estado.puede) {
      const mensajes: Record<string, string> = {
        "ya-tiene-molde":
          "Esta partida ya está guardada en el catálogo. Usá “↑ Precios a catálogo” para actualizar el molde.",
        "nombre-repetido": `Ya existe una partida “${estado.moldeNombre}” en la categoría ${estado.categoria} del catálogo. No se creó nada: cambiale el nombre a esta partida, o actualizá la del catálogo desde ahí.`,
        "sin-capitulo": "La partida no tiene capítulo, así que no sé en qué categoría del catálogo guardarla.",
        "sin-nombre": "La partida no tiene nombre.",
      };
      return NextResponse.json(
        { error: mensajes[estado.motivo] ?? "No se puede guardar al catálogo", ...estado },
        { status: 409 }
      );
    }

    const item = await prisma.obraItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        name: true,
        unit: true,
        unitPrice: true,
        descriptionCliente: true,
        descriptionMaestro: true,
        costMaterial: true,
        costLabor: true,
        costTools: true,
        costMargin: true,
        costLoss: true,
        costSubcontract: true,
        _count: { select: { components: true } },
      },
    });

    // Al final de su categoría. (El listado del catálogo igual ordena
    // alfabético dentro de cada categoría desde 2026-05-08, pero sortOrder se
    // sigue guardando coherente.)
    const ultimo = await prisma.partidaCatalog.findFirst({
      where: { category: estado.categoria },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const molde = await prisma.partidaCatalog.create({
      data: {
        category: estado.categoria,
        name: item.name.trim(),
        unit: item.unit || "GL",
        sortOrder: (ultimo?.sortOrder ?? -1) + 1,
        descriptionCliente: item.descriptionCliente,
        descriptionMaestro: item.descriptionMaestro,
        unitPrice: item.unitPrice || 0,
        costMaterial: item.costMaterial ?? 0,
        costLabor: item.costLabor ?? 0,
        costTools: item.costTools ?? 0,
        costMargin: item.costMargin ?? 0,
        costLoss: item.costLoss ?? 0,
        costSubcontract: item.costSubcontract ?? 0,
      },
    });

    // Enganchar la partida al molde. Tiene que ir ANTES del push del desglose:
    // pushObraItemComponentsToCatalog lee catalogPartidaId del ObraItem y tira
    // SinCatalogoError si todavía está vacío.
    await prisma.obraItem.update({
      where: { id: itemId },
      data: { catalogPartidaId: molde.id },
    });

    // Copiar el desglose. OJO: solo si la partida TIENE desglose. Con cero
    // líneas, el push igual terminaría llamando a recalcPartidaTotals, que
    // recalcula el molde desde sus componentes y dejaría el precio y los 6
    // rubros en $0 — justo los que acabamos de copiar a mano. Las partidas sin
    // desglose (las de monto global) se quedan con esos montos y listo.
    let pushed = 0;
    if (item._count.components > 0) {
      const r = await pushObraItemComponentsToCatalog(itemId);
      pushed = r.pushed;
    }

    return NextResponse.json({
      ok: true,
      catalogPartidaId: molde.id,
      categoria: molde.category,
      categoriaEsNueva: estado.categoriaEsNueva,
      nombre: molde.name,
      pushed,
    });
  } catch (error) {
    console.error("Error creando partida en el catálogo:", error);
    return NextResponse.json({ error: "Error al guardar al catálogo" }, { status: 500 });
  }
}
