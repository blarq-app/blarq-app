/**
 * Revisión masiva de precios e imágenes de los artefactos de un presupuesto.
 *
 * GET /api/presupuestos/{id}/artefactos/revisar-precios
 *   Recorre los artefactos del presupuesto que tienen referenceLink, baja
 *   cada página de producto y devuelve un diff (precio/imagen actual vs.
 *   en línea). NO escribe nada — la UI decide qué aplicar.
 *
 * Es un GET porque es idempotente (solo lee). Puede tardar varios segundos
 * con presupuestos grandes — el scraper procesa de a 5 links en paralelo.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { revisarArtefactosOnline } from "@/lib/catalog/revisarArtefactos";

export const runtime = "nodejs";
// El scraper puede tardar — damos margen amplio.
export const maxDuration = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;

    const items = await prisma.artefactoItem.findMany({
      where: { budgetVersionId },
      select: {
        id: true,
        name: true,
        room: true,
        referenceLink: true,
        listPrice: true,
        imageUrl: true,
      },
    });

    const result = await revisarArtefactosOnline(items);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error revisando precios de artefactos:", error);
    return NextResponse.json(
      { error: "Error al revisar precios online" },
      { status: 500 }
    );
  }
}
