/**
 * Catálogo BLARQ de herrajes (para cotizar muebles). Espejo del de artefactos,
 * pero los herrajes se compran por PROVEEDOR (HBT / DPH) y tienen UN costo neto
 * (el precio a cliente se deriva ×1,2 en la UI). Ver modelo HerrajeCatalog.
 *
 * GET  /api/catalogo/herrajes?q=&supplier=&category=
 *   Lista del catálogo. Búsqueda liviana contra name + detail + brand + sku.
 *
 * POST /api/catalogo/herrajes
 *   Crea un herraje. "name", "supplier" y "category" son obligatorios.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/apiAuth";

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const supplier = sp.get("supplier")?.trim();
  const category = sp.get("category")?.trim();

  const where: Prisma.HerrajeCatalogWhereInput = {};
  if (supplier) where.supplier = supplier;
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { detail: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.herrajeCatalog.findMany({
    where,
    orderBy: [
      { supplier: "asc" },
      { category: "asc" },
      { sortOrder: "asc" }, // orden manual dentro de proveedor+categoría
      { name: "asc" }, // fallback estable cuando empatan
    ],
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    if (!data.name || !data.supplier || !data.category) {
      return NextResponse.json(
        { error: "name, supplier y category son obligatorios" },
        { status: 400 },
      );
    }
    // El herraje nuevo se ubica al final de su (proveedor, categoría).
    const last = await prisma.herrajeCatalog.findFirst({
      where: { supplier: data.supplier, category: data.category },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? 0) + 1;

    const item = await prisma.herrajeCatalog.create({
      data: {
        name: data.name,
        detail: data.detail ?? null,
        supplier: data.supplier,
        category: data.category,
        subgroup: data.subgroup ?? null,
        measure: data.measure ?? null,
        finish: data.finish ?? null,
        brand: data.brand ?? null,
        sku: data.sku ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        costNet: data.costNet ?? 0,
        clientPrice: data.clientPrice ?? null,
        sortOrder: nextSortOrder,
        lastPriceCheck: data.costNet && data.costNet > 0 ? new Date() : null,
      },
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating catalog herraje:", error);
    return NextResponse.json(
      { error: "Error al crear herraje del catálogo" },
      { status: 500 },
    );
  }
}
