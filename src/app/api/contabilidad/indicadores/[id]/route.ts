import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Edición de un indicador del mes. UF/UTM se traen solas, pero quedan
// editables por si hay que ajustarlas a mano; los dos topes se editan acá.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const data = await request.json();

  const update: Record<string, unknown> = {};
  if (data.uf !== undefined) update.uf = Number(data.uf) || 0;
  if (data.utm !== undefined) update.utm = Number(data.utm) || 0;
  if (data.gratificacionTopeMensual !== undefined)
    update.gratificacionTopeMensual = Math.round(
      Number(data.gratificacionTopeMensual) || 0
    );
  if (data.topeImponibleSaludUF !== undefined)
    update.topeImponibleSaludUF = Number(data.topeImponibleSaludUF) || 0;

  const updated = await prisma.indicadorMensual.update({
    where: { id },
    data: update,
  });
  return NextResponse.json(updated);
}
