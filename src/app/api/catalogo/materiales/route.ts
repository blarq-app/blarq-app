import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const category = searchParams.get("category") || "";
    const limit = parseInt(searchParams.get("limit") || "500");

    const where: any = {};
    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }
    if (category) {
      where.category = category;
    }

    const materials = await prisma.materialCatalog.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: limit,
    });

    return NextResponse.json(materials);
  } catch (error) {
    console.error("Error searching materials:", error);
    return NextResponse.json(
      { error: "Error al buscar materiales" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    if (!data.name || !data.category) {
      return NextResponse.json(
        { error: "Nombre y categoría son requeridos" },
        { status: 400 }
      );
    }

    const material = await prisma.materialCatalog.create({
      data: {
        name: data.name.toUpperCase().trim(),
        category: data.category.toUpperCase().trim(),
        unit: data.unit || "UN",
        netPrice: data.netPrice || 0,
        isProvision: data.isProvision ?? false,
        referenceLink: data.referenceLink || null,
      },
    });

    return NextResponse.json(material);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Ya existe un material con ese nombre" },
        { status: 409 }
      );
    }
    console.error("Error creating material:", error);
    return NextResponse.json(
      { error: "Error al crear material" },
      { status: 500 }
    );
  }
}
