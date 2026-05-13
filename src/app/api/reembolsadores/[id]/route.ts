import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.reembolsador.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await request.json();
  const update: Record<string, unknown> = {};
  if (data.nombre !== undefined) update.nombre = String(data.nombre).trim();
  if (data.glosa !== undefined) update.glosa = String(data.glosa).trim().toLowerCase();
  if (data.rutAlias !== undefined) {
    update.rutAlias = data.rutAlias ? String(data.rutAlias).trim() : null;
  }
  if (data.businessName !== undefined) {
    update.businessName = data.businessName ? String(data.businessName).trim() : null;
  }
  const updated = await prisma.reembolsador.update({ where: { id }, data: update });
  return NextResponse.json(updated);
}
