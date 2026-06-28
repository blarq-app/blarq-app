import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Empleados (trabajadores con sueldo) de la pantalla de Remuneraciones.

export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const empleados = await prisma.empleado.findMany({
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json({ empleados });
}

// Campos numéricos del empleado, con saneo. afpComisionRate e isaprePlanUF son
// decimales; el resto son pesos enteros.
function parseEmpleadoBody(data: Record<string, unknown>) {
  return {
    nombre: String(data.nombre ?? "").trim(),
    rut: String(data.rut ?? "").trim(),
    sueldoBase: Math.round(Number(data.sueldoBase) || 0),
    colacion: Math.round(Number(data.colacion) || 0),
    movilizacion: Math.round(Number(data.movilizacion) || 0),
    afpNombre: data.afpNombre ? String(data.afpNombre).trim() : null,
    afpComisionRate: Number(data.afpComisionRate) || 0,
    isapreNombre: data.isapreNombre ? String(data.isapreNombre).trim() : null,
    isaprePlanUF: Number(data.isaprePlanUF) || 0,
  };
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  const body = parseEmpleadoBody(data);
  if (!body.nombre || !body.rut) {
    return NextResponse.json(
      { error: "Nombre y RUT son obligatorios" },
      { status: 400 }
    );
  }

  try {
    const created = await prisma.empleado.create({ data: body });
    return NextResponse.json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Ya existe un empleado con ese RUT" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
