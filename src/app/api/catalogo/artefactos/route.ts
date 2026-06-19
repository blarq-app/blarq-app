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
import { requireSession } from "@/lib/apiAuth";

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
      { subcategory: "asc" },
      { sortOrder: "asc" }, // orden manual dentro de la pestaña
      { name: "asc" }, // fallback estable cuando empatan en sortOrder
    ],
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    if (!data.name || !data.subcategory) {
      return NextResponse.json(
        { error: "name y subcategory son obligatorios" },
        { status: 400 }
      );
    }
    // El artefacto nuevo se ubica al final de su pestaña: tomamos el
    // sortOrder más alto de esa subcategoría y le sumamos uno.
    const last = await prisma.artefactoCatalog.findFirst({
      where: { subcategory: data.subcategory },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? 0) + 1;
    // Carpeta (subgroup): si viene explícita se respeta; si no, se arma sola a
    // partir de línea+color (igual que agrupaba antes). Así el artefacto nuevo
    // cae junto a los de su misma línea/color y MJ lo mueve si quiere. Null si
    // no tiene ni línea ni color (queda en "Sin carpeta / Otros").
    const autoSubgroup =
      [data.line, data.finish]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .join(" · ") || null;
    const subgroup =
      typeof data.subgroup === "string" && data.subgroup.trim()
        ? data.subgroup.trim()
        : autoSubgroup;
    const item = await prisma.artefactoCatalog.create({
      data: {
        name: data.name,
        detail: data.detail ?? null,
        brand: data.brand ?? null,
        subcategory: data.subcategory,
        tag: data.tag ?? null,
        line: data.line ?? null,
        finish: data.finish ?? null,
        subgroup,
        supplier: data.supplier ?? null,
        referenceLink: data.referenceLink ?? null,
        imageUrl: data.imageUrl ?? null,
        listPrice: data.listPrice ?? 0,
        discountPercent: data.discountPercent ?? null,
        // Precio a cliente: si no llega, arranca = precio web (listPrice).
        clientPrice: data.clientPrice ?? data.listPrice ?? 0,
        // Mi costo real (lo que paga BLARQ): manual, puede venir vacío.
        realCostBlarq: data.realCostBlarq ?? null,
        isStandard: !!data.isStandard,
        sortOrder: nextSortOrder,
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
