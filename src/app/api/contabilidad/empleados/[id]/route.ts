import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Update parcial de un empleado. Solo pisa los campos que vienen en el body.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const data = await request.json();

  const update: Record<string, unknown> = {};
  if (data.nombre !== undefined) update.nombre = String(data.nombre).trim();
  if (data.rut !== undefined) update.rut = String(data.rut).trim();
  if (data.sueldoBase !== undefined)
    update.sueldoBase = Math.round(Number(data.sueldoBase) || 0);
  if (data.colacion !== undefined)
    update.colacion = Math.round(Number(data.colacion) || 0);
  if (data.movilizacion !== undefined)
    update.movilizacion = Math.round(Number(data.movilizacion) || 0);
  if (data.afpNombre !== undefined)
    update.afpNombre = data.afpNombre ? String(data.afpNombre).trim() : null;
  if (data.afpComisionRate !== undefined)
    update.afpComisionRate = Number(data.afpComisionRate) || 0;
  if (data.isapreNombre !== undefined)
    update.isapreNombre = data.isapreNombre
      ? String(data.isapreNombre).trim()
      : null;
  if (data.isaprePlanUF !== undefined)
    update.isaprePlanUF = Number(data.isaprePlanUF) || 0;
  if (data.activo !== undefined) update.activo = Boolean(data.activo);

  try {
    const updated = await prisma.empleado.update({ where: { id }, data: update });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al actualizar";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Ya existe un empleado con ese RUT" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  await prisma.empleado.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
