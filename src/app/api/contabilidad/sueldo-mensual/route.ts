import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Ajuste del sueldo imponible (base + bono) de un empleado en un mes.
//   POST   { empleadoId, year, month, sueldoBase }  -> crea/actualiza el ajuste
//   DELETE ?empleadoId=&year=&month=                -> vuelve al sueldo estándar

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  const empleadoId = String(data.empleadoId ?? "");
  const year = Number(data.year);
  const month = Number(data.month);
  const sueldoBase = Math.round(Number(data.sueldoBase) || 0);

  if (!empleadoId || !year || month < 1 || month > 12 || sueldoBase <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const saved = await prisma.sueldoMensual.upsert({
    where: { empleadoId_year_month: { empleadoId, year, month } },
    update: { sueldoBase },
    create: { empleadoId, year, month, sueldoBase },
  });
  return NextResponse.json(saved);
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const empleadoId = sp.get("empleadoId") ?? "";
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));

  if (!empleadoId || !year || month < 1 || month > 12) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  await prisma.sueldoMensual.deleteMany({ where: { empleadoId, year, month } });
  return NextResponse.json({ ok: true });
}
