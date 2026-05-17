import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
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
        sortOrder: data.sortOrder,
      },
    });

    // ── Sincronización entre instancias del mismo catalogId ─────────────
    //
    // Si el item pertenece al catálogo BLARQ (tiene catalogId), tenemos
    // dos scopes distintos según el campo:
    //
    //   ALL SCOPES (web — sirve para próximos proyectos también):
    //     name, detail, brand, listPrice, discountPercent, clientPrice,
    //     referenceLink, imageUrl.
    //     → propaga a otras copias del mismo budget Y al catálogo global.
    //
    //   BUDGET ONLY (cotización privada de tu vendedora, varía por proyecto):
    //     realCostBlarq.
    //     → propaga solo a otras copias del mismo budget.
    //     NO sube al catálogo global (la cotización de un proyecto no
    //     debe pisar el costo registrado para los demás).
    //
    // NUNCA se sincroniza:
    //   - quantity, room, subcategory, sortOrder (específicos del item
    //     dentro del budget).
    //   - catalogId (obvio).
    if (item.catalogId) {
      const sharedAllScopes = {
        name: item.name,
        detail: item.detail,
        brand: item.brand,
        listPrice: item.listPrice,
        discountPercent: item.discountPercent,
        clientPrice: item.clientPrice,
        referenceLink: item.referenceLink,
        imageUrl: item.imageUrl,
      };

      // Otras copias en el mismo budget — incluye también realCostBlarq.
      await prisma.artefactoItem.updateMany({
        where: {
          budgetVersionId,
          catalogId: item.catalogId,
          id: { not: itemId },
        },
        data: {
          ...sharedAllScopes,
          realCostBlarq: item.realCostBlarq,
        },
      });

      // Catálogo BLARQ — solo los campos que valen para próximos proyectos.
      await prisma.artefactoCatalog
        .update({
          where: { id: item.catalogId },
          data: {
            ...sharedAllScopes,
            lastPriceCheck: new Date(),
          },
        })
        .catch(() => {
          /* puede haberse borrado del catálogo — ignorar */
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
