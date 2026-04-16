import { prisma } from "@/lib/prisma";
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
      where.name = { contains: q };
    }
    if (category) {
      where.category = category;
    }

    const partidas = await prisma.partidaCatalog.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: limit,
      include: {
        components: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return NextResponse.json(partidas);
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

    const partida = await prisma.partidaCatalog.create({
      data: {
        category: data.category,
        name: data.name,
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
