import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { editoCampoDeCatalogo, editoElDescuento } from "@/lib/catalog/syncArtefactos";

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

    // ── Quién manda sobre el precio de esta línea ────────────────────────
    //
    // Dos marcas distintas, separadas el 2026-08-02:
    //
    //   priceOverridden    → MJ fijó un PRECIO a mano (la lista, o el precio al
    //                        cliente por fuera del descuento). El catálogo no
    //                        vuelve a tocar esta línea. Es definitivo.
    //   discountOverridden → MJ decidió el DESCUENTO. El catálogo sigue
    //                        actualizando el precio de lista y los datos del
    //                        producto, pero respeta ese porcentaje.
    //
    // Antes había una sola marca y el descuento caía adentro, así que "le doy
    // 45% a esta clienta" congelaba la línea y esa cotización no se enteraba
    // nunca más de los cambios de precio. Tampoco despegan ya el nombre, el
    // detalle, la marca, el link ni la foto: no tienen nada que ver con plata.
    //
    // Comparamos contra el valor guardado porque el editor manda la fila
    // completa en cada guardado y no sabríamos qué cambió.
    const prev = await prisma.artefactoItem.findUnique({
      where: { id: itemId },
      select: {
        priceOverridden: true,
        discountOverridden: true,
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
    const entrante = {
      listPrice,
      discountPercent: discountPct,
      clientPrice,
      name: data.name ?? null,
      detail: data.detail ?? null,
      brand: data.brand ?? null,
      referenceLink: data.referenceLink ?? null,
      imageUrl: data.imageUrl ?? null,
    };
    const editoCampoCatalogo = !!prev && editoCampoDeCatalogo(prev, entrante);
    const despego = !!prev && !prev.priceOverridden && editoCampoCatalogo;
    const priceOverridden = prev?.priceOverridden || editoCampoCatalogo;
    // Volver al descuento de la tienda es una ACCIÓN explícita (la flechita de
    // la columna DCTO), y por eso viaja en su propio campo.
    //
    // OJO, error que estuvo unas horas acá: se miraba `data.discountOverridden
    // === false`. Pero el editor manda la FILA COMPLETA en cada guardado, con
    // el valor que la línea tenía antes — así que cualquier guardado normal de
    // una línea sin descuento propio parecía un "volvé al de la tienda", y el
    // porcentaje que MJ acababa de escribir se pisaba con el del catálogo. O
    // sea: rompía exactamente lo que este cambio venía a habilitar.
    const vuelveAlDeLaTienda = data.volverAlDescuentoDeLaTienda === true;
    // El descuento que llega NO lo decidió MJ: lo trae la tienda. Lo manda
    // "Comparar con la tienda web" al aplicar. Sin esto, aceptar el precio de
    // internet marcaba la línea como si el porcentaje fuera una decisión suya
    // y esa línea dejaba de recibir los descuentos nuevos del catálogo — el
    // mismo congelamiento que veníamos arreglando, con otro nombre.
    const dctoVieneDeLaTienda = data.descuentoDeLaTienda === true;
    const discountOverridden =
      vuelveAlDeLaTienda || dctoVieneDeLaTienda
        ? false
        : !!prev && (prev.discountOverridden || editoElDescuento(prev, entrante));

    // Al volver al descuento de la tienda hay que ir a buscarlo: el editor no
    // lo tiene en la línea (guarda el efectivo). Si el producto ya no está en
    // el catálogo, se conserva el que había — mejor eso que ponerlo en 0.
    let dctoFinal = discountPct;
    let clientFinal = clientPrice;
    if (vuelveAlDeLaTienda && data.catalogId) {
      const cat = await prisma.artefactoCatalog.findUnique({
        where: { id: data.catalogId },
        select: { discountPercent: true },
      });
      if (cat) {
        dctoFinal = cat.discountPercent ?? 0;
        clientFinal = listPrice * (1 - dctoFinal);
      }
    }

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
        discountPercent: dctoFinal,
        clientPrice: clientFinal,
        realCostBlarq: data.realCostBlarq ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        catalogId: data.catalogId ?? null,
        priceOverridden,
        discountOverridden,
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
          discountOverridden: item.discountOverridden,
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
          discountOverridden: item.discountOverridden,
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
