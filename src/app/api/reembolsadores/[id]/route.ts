import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  await prisma.reembolsador.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/**
 * Update parcial. Acepta nombre/glosa/aliases.
 *   aliases: { rut: string; businessName?: string | null }[]   reemplaza
 *            la lista completa (delete + create dentro de una transacción).
 *
 * Compat: `rutAlias` y `businessName` legacy siguen siendo aceptados —
 * si vienen sin `aliases`, se convierten en un alias unico (reemplazo
 * de toda la lista). Asi codigo viejo sigue funcionando hasta que se
 * migre todo.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const data = await request.json();

  // Construimos el `data` del update incrementalmente segun lo que vino
  // en el body. Si vienen `aliases`, reemplazamos la lista completa.
  const baseUpdate: Record<string, unknown> = {};
  if (data.nombre !== undefined) baseUpdate.nombre = String(data.nombre).trim();
  if (data.glosa !== undefined)
    baseUpdate.glosa = String(data.glosa).trim().toLowerCase();
  if (data.personRut !== undefined)
    baseUpdate.personRut = data.personRut ? String(data.personRut).trim() : null;

  // ¿Hay que reemplazar aliases? Disparado por aliases array O por los
  // campos legacy rutAlias/businessName (en este ultimo caso se convierte
  // en un alias unico).
  let aliasesPayload: { rut: string; businessName: string | null }[] | null =
    null;
  if (Array.isArray(data.aliases)) {
    aliasesPayload = [];
    for (const a of data.aliases) {
      const rut = String(a?.rut ?? "").trim();
      const bn = a?.businessName ? String(a.businessName).trim() : null;
      if (rut) aliasesPayload.push({ rut, businessName: bn });
    }
  } else if (data.rutAlias !== undefined || data.businessName !== undefined) {
    // Modo legacy: un solo alias o ninguno.
    const rut = data.rutAlias ? String(data.rutAlias).trim() : "";
    const bn = data.businessName ? String(data.businessName).trim() : null;
    aliasesPayload = rut ? [{ rut, businessName: bn }] : [];
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (aliasesPayload !== null) {
      // Reemplazo total de aliases.
      await tx.reembolsadorAlias.deleteMany({ where: { reembolsadorId: id } });
      if (aliasesPayload.length > 0) {
        await tx.reembolsadorAlias.createMany({
          data: aliasesPayload.map((a) => ({
            reembolsadorId: id,
            rut: a.rut,
            businessName: a.businessName,
          })),
        });
      }
      // Mantener campos legacy poblados con el primer alias.
      baseUpdate.rutAlias = aliasesPayload[0]?.rut ?? null;
      baseUpdate.businessName = aliasesPayload[0]?.businessName ?? null;
    }

    return tx.reembolsador.update({
      where: { id },
      data: baseUpdate,
      include: { aliases: { orderBy: { createdAt: "asc" } } },
    });
  });

  return NextResponse.json(updated);
}
