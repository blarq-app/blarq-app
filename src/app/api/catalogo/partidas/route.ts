import { prisma } from "@/lib/prisma";
import { compareCatalogCategories } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

// Search partidas catalog
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const category = searchParams.get("category") || "";
    const limit = parseInt(searchParams.get("limit") || "50");

    const where: any = {};

    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }
    if (category) {
      where.category = category;
    }

    // Trae todo y luego ordena por orden lógico de obra (Prisma no soporta
    // orderBy con un array fijo). El orden interno de cada categoría sigue
    // siendo sortOrder + name como antes.
    const rawPartidas = await prisma.partidaCatalog.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: limit,
      include: {
        components: {
          orderBy: { sortOrder: "asc" },
          include: { material: true },
        },
      },
    });
    const partidas = rawPartidas.sort((a, b) => {
      const c = compareCatalogCategories(a.category, b.category);
      if (c !== 0) return c;
      const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (so !== 0) return so;
      return a.name.localeCompare(b.name);
    });

    // Agregar campo derivado: provisiones de esta partida
    const result = partidas.map((p) => {
      const provisions = p.components
        .filter((c) => c.type === "material" && c.material?.isProvision)
        .map((c) => ({
          componentId: c.id,
          name: c.material?.name ?? c.description,
          unitCost: c.unitCost,   // precio neto de referencia del catálogo
          quantity: c.quantity,   // qty por unidad de partida
        }));
      return { ...p, provisions };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error searching partidas:", error);
    return NextResponse.json(
      { error: "Error al buscar partidas" },
      { status: 500 }
    );
  }
}

// Create new partida in catalog
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    // Calcular siguiente sortOrder en la categoría
    const last = await prisma.partidaCatalog.findFirst({
      where: { category: data.category },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? -1) + 1;

    const partida = await prisma.partidaCatalog.create({
      data: {
        category: data.category,
        name: data.name,
        descriptionCliente: data.descriptionCliente ?? data.description ?? null,
        descriptionMaestro: data.descriptionMaestro ?? null,
        sortOrder: nextSortOrder,
        unit: data.unit || "GL",
        unitPrice: data.unitPrice || 0,
        costMaterial: data.costMaterial || 0,
        costLabor: data.costLabor || 0,
        costTools: data.costTools || 0,
        costMargin: data.costMargin || 0,
        costLoss: data.costLoss || 0,
        costSubcontract: data.costSubcontract || 0,
      },
    });

    return NextResponse.json(partida);
  } catch (error) {
    console.error("Error creating partida:", error);
    return NextResponse.json(
      { error: "Error al crear partida" },
      { status: 500 }
    );
  }
}
