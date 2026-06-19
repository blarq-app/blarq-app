import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { editoCampoDeCatalogo } from "@/lib/catalog/syncArtefactos";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId, itemId } = await params;
    const data = await request.json();

    // Convención: discountPercent es decimal (0..1) y clientPrice es
    // unitario (no incluye qty). El editor manda valores ya calculados.
    // Si no llega clientPrice explícito, lo recalculamos.
    const listPrice = data.listPrice ?? 0;
    const discountPct = data.discountPercent ?? 0;
    const quantity = data.quantity ?? 1;
    const clientPrice =
      data.clientPrice !== undefined && data.clientPrice !== null
        ? data.clientPrice
        : listPrice * (1 - discountPct);

    // ── "Despegar" del catálogo (rediseño precios artefactos 2026-06-18) ──
    //
    // Si MJ edita a mano alguno de los campos que vienen del catálogo (precio,
    // descuento, precio cliente, nombre, detalle, marca, link, foto), la línea
    // queda DESPEGADA: priceOverridden=true y el catálogo no la vuelve a pisar.
    // Cambiar solo cantidad / ambiente / orden NO despega (no vienen del
    // catálogo). Comparamos contra el valor guardado para decidirlo, porque el
    // editor manda la fila completa en cada guardado y no sabríamos qué cambió.
    // Una vez despegada, queda despegada (no se "vuelve a pegar" sola).
    const prev = await prisma.artefactoItem.findUnique({
      where: { id: itemId },
      select: {
        priceOverridden: true,
        listPrice: true,
        discountPercent: true,
        clientPrice: true,
        name: true,
        detail: true,
        brand: true,
        referenceLink: true,
        imageUrl: true,
      },
    });
    const editoCampoCatalogo =
      !!prev &&
      editoCampoDeCatalogo(prev, {
        listPrice,
        discountPercent: discountPct,
        clientPrice,
        name: data.name ?? null,
        detail: data.detail ?? null,
        brand: data.brand ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
      });
    const despego = !!prev && !prev.priceOverridden && editoCampoCatalogo;
    const priceOverridden = prev?.priceOverridden || editoCampoCatalogo;

    const item = await prisma.artefactoItem.update({
      where: { id: itemId },
      data: {
        room: data.room,
        subcategory: data.subcategory,
        name: data.name,
        detail: data.detail,
        brand: data.brand,
        quantity,
        listPrice,
        discountPercent: discountPct,
        clientPrice,
        realCostBlarq: data.realCostBlarq ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        catalogId: data.catalogId ?? null,
        priceOverridden,
        sortOrder: data.sortOrder,
      },
    });

    // ── Sincronización entre copias del mismo catalogId DENTRO del budget ─
    //
    // Si el item viene del catálogo (tiene catalogId), copiamos sus datos a las
    // otras instancias del MISMO producto dentro de ESTA cotización (mismo WC
    // en baño principal y secundario = datos idénticos). Incluye realCostBlarq
    // porque el costo se carga por proyecto: si MJ lo pone en una copia, vale
    // para todas las del mismo proyecto.
    //
    // IMPORTANTE (rediseño 2026-06-18): editar dentro de una cotización YA NO
    // sube al catálogo global. El catálogo es el maestro y solo se edita desde
    // /catálogo; una edición en la cotización queda SOLO ahí (regla de MJ).
    // Por eso se eliminó el `prisma.artefactoCatalog.update` que había acá.
    //
    // Si esta edición despegó la línea, las copias del mismo producto en la
    // cotización también se despegan: recibieron el valor manual, así que el
    // catálogo tampoco debe volver a pisarlas (si no, quedarían inconsistentes
    // con la línea editada en la próxima actualización del catálogo).
    //
    // NUNCA se sincroniza: quantity, room, subcategory, sortOrder, catalogId.
    if (item.catalogId) {
      await prisma.artefactoItem.updateMany({
        where: {
          budgetVersionId,
          catalogId: item.catalogId,
          id: { not: itemId },
        },
        data: {
          name: item.name,
          detail: item.detail,
          brand: item.brand,
          listPrice: item.listPrice,
          discountPercent: item.discountPercent,
          clientPrice: item.clientPrice,
          referenceLink: item.referenceLink,
          imageUrl: item.imageUrl,
          realCostBlarq: item.realCostBlarq,
          ...(despego && { priceOverridden: true }),
        },
      });
    }

    // ── Sincronización entre artefactos con el MISMO NOMBRE ─────────────
    //
    // Aunque dos artefactos no vengan del catálogo (caso típico: WC
    // importados de un Excel), si se llaman igual dentro de la misma
    // cotización son el mismo producto. Cuando MJ edita uno, copiamos
    // link / foto / precio / marca / detalle a los demás con ese nombre.
    // Así carga el link de un "WC ATENAS" una vez y se completa en todos
    // los baños.
    //
    // NO se copia: name (es la clave que los agrupa), realCostBlarq
    // (costo interno, puede variar por item), quantity / room /
    // subcategory (propios de cada copia).
    const nombre = item.name?.trim();
    if (nombre) {
      await prisma.artefactoItem.updateMany({
        where: {
          budgetVersionId,
          id: { not: itemId },
          name: { equals: nombre, mode: "insensitive" },
        },
        data: {
          detail: item.detail,
          brand: item.brand,
          listPrice: item.listPrice,
          discountPercent: item.discountPercent,
          clientPrice: item.clientPrice,
          referenceLink: item.referenceLink,
          imageUrl: item.imageUrl,
          // Si la edición despegó la línea, las gemelas por nombre también: ya
          // tienen el valor manual y el catálogo no debe volver a pisarlas.
          ...(despego && { priceOverridden: true }),
        },
      });
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating artefacto item:", error);
    return NextResponse.json(
      { error: "Error al actualizar artefacto" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    await prisma.artefactoItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting artefacto item:", error);
    return NextResponse.json(
      { error: "Error al eliminar artefacto" },
      { status: 500 }
    );
  }
}
