import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const maestros = await prisma.maestro.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(maestros);
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    if (!data.name) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }
    const maestro = await prisma.maestro.create({
      data: {
        name: data.name,
        rut: data.rut || null,
        phone: data.phone || null,
        emitsInvoice: !!data.emitsInvoice,
        notes: data.notes || null,
      },
    });
    return NextResponse.json(maestro);
  } catch (error) {
    console.error("Error creating maestro:", error);
    return NextResponse.json({ error: "Error al crear maestro" }, { status: 500 });
  }
}
