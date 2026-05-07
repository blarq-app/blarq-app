import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const items = await prisma.reembolsador.findMany({
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json({ reembolsadores: items });
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const nombre = String(data.nombre ?? "").trim();
    const glosa = String(data.glosa ?? "").trim().toLowerCase();
    if (!nombre || !glosa) {
      return NextResponse.json(
        { error: "Nombre y glosa son obligatorios" },
        { status: 400 }
      );
    }
    const created = await prisma.reembolsador.create({
      data: { nombre, glosa },
    });
    return NextResponse.json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Ya existe un reembolsador con esa glosa" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
