/**
 * CRUD por id de un herraje del catálogo.
 *
 * PUT    /api/catalogo/herrajes/{id} — actualiza campos.
 * DELETE /api/catalogo/herrajes/{id} — borra del catálogo.
 *
 * (Sin propagación a cotizaciones: los items de muebles llegan en Fase 2.)
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    // Si llega costNet nuevo, refrescamos lastPriceCheck.
    const updateLastCheck = data.costNet !== undefined && data.costNet !== null;

    const item = await prisma.herrajeCatalog.update({
      where: { id },
      data: {
        name: data.name,
        detail: data.detail,
        supplier: data.supplier,
        category: data.category,
        subgroup: data.subgroup,
        measure: data.measure,
        finish: data.finish,
        brand: data.brand,
        sku: data.sku,
        referenceLink: data.referenceLink,
        imageUrl: data.imageUrl,
        costNet: data.costNet,
        clientPrice: data.clientPrice,
        ...(updateLastCheck && { lastPriceCheck: new Date() }),
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating catalog herraje:", error);
    return NextResponse.json(
      { error: "Error al actualizar herraje del catálogo" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    await prisma.herrajeCatalog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting catalog herraje:", error);
    return NextResponse.json(
      { error: "Error al borrar herraje del catálogo" },
      { status: 500 },
    );
  }
}
