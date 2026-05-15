/**
 * Catálogo BLARQ de artefactos.
 *
 * GET  /api/catalogo/artefactos?q=&subcategory=&tag=&isStandard=
 *   Lista items del catálogo. Soporta filtros + búsqueda full-text liviana
 *   contra name + detail + brand.
 *
 * POST /api/catalogo/artefactos
 *   Crea un item nuevo en el catálogo. Body: { name, subcategory, ... }.
 *   "name" y "subcategory" son obligatorios; el resto es opcional.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const subcategory = sp.get("subcategory")?.trim();
  const tag = sp.get("tag")?.trim();
  const isStandard = sp.get("isStandard");

  const where: Prisma.ArtefactoCatalogWhereInput = {};
  if (subcategory) where.subcategory = subcategory;
  if (tag) where.tag = tag;
  if (isStandard === "true") where.isStandard = true;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { detail: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { supplier: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.artefactoCatalog.findMany({
    where,
    orderBy: [
      { isStandard: "desc" }, // estándares primero
      { subcategory: "asc" },
      { name: "asc" },
    ],
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    if (!data.name || !data.subcategory) {
      return NextResponse.json(
        { error: "name y subcategory son obligatorios" },
        { status: 400 }
      );
    }
    const item = await prisma.artefactoCatalog.create({
      data: {
        name: data.name,
        detail: data.detail ?? null,
        brand: data.brand ?? null,
        subcategory: data.subcategory,
        tag: data.tag ?? null,
        supplier: data.supplier ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        listPrice: data.listPrice ?? 0,
        discountPercent: data.discountPercent ?? null,
        isStandard: !!data.isStandard,
        lastPriceCheck: data.listPrice && data.listPrice > 0 ? new Date() : null,
      },
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating catalog artefacto:", error);
    return NextResponse.json(
      { error: "Error al crear item del catálogo" },
      { status: 500 }
    );
  }
}
