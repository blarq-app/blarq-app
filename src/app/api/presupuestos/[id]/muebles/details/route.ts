import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Crear detalle bajo un MuebleItem (componente: CUERPO INTERIOR / TRASERA / etc).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // consume
    const data = await request.json();
    if (!data.itemId) {
      return NextResponse.json(
        { error: "itemId requerido" },
        { status: 400 }
      );
    }

    const existing = await prisma.muebleDetail.findMany({
      where: { itemId: data.itemId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSort = existing.length > 0 ? existing[0].sortOrder + 1 : 0;

    const detail = await prisma.muebleDetail.create({
      data: {
        itemId: data.itemId,
        name: data.name || "NUEVO COMPONENTE",
        material: data.material || "",
        sortOrder: nextSort,
      },
    });
    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error creating mueble detail:", error);
    return NextResponse.json(
      { error: "Error al crear detalle" },
      { status: 500 }
    );
  }
}
