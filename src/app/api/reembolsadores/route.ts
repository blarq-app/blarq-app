import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

/**
 * Devuelve todos los reembolsadores con su lista de aliases incluida.
 * El modal de conciliación usa esto para detectar matches por glosa y
 * armar el filtro de RUTs cuando un reembolsador tiene aliases.
 */
export async function GET() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const items = await prisma.reembolsador.findMany({
    orderBy: { nombre: "asc" },
    include: { aliases: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ reembolsadores: items });
}

/**
 * Crea un reembolsador. El cuerpo acepta:
 *   nombre: string
 *   glosa: string
 *   aliases: { rut: string; businessName?: string | null }[]   (opcional)
 *
 * Para compat con código viejo también se aceptan los campos legacy
 * `rutAlias` y `businessName` (se convierten en un alias).
 */
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();
    const nombre = String(data.nombre ?? "").trim();
    const glosa = String(data.glosa ?? "").trim().toLowerCase();
    const personRut = data.personRut ? String(data.personRut).trim() : null;
    if (!nombre || !glosa) {
      return NextResponse.json(
        { error: "Nombre y glosa son obligatorios" },
        { status: 400 }
      );
    }

    // Normalizamos los aliases del payload. Aceptamos `aliases` (nuevo)
    // y `rutAlias`/`businessName` (legacy, lo metemos como un alias mas).
    const aliasInputs: { rut: string; businessName: string | null }[] = [];
    if (Array.isArray(data.aliases)) {
      for (const a of data.aliases) {
        const rut = String(a?.rut ?? "").trim();
        const bn = a?.businessName ? String(a.businessName).trim() : null;
        if (rut) aliasInputs.push({ rut, businessName: bn });
      }
    }
    if (data.rutAlias && !aliasInputs.some((a) => a.rut === String(data.rutAlias).trim())) {
      aliasInputs.push({
        rut: String(data.rutAlias).trim(),
        businessName: data.businessName ? String(data.businessName).trim() : null,
      });
    }

    const created = await prisma.reembolsador.create({
      data: {
        nombre,
        glosa,
        personRut,
        // Mantenemos los campos legacy poblados con el primer alias si
        // existe — así código viejo que aún los lea no se rompe.
        rutAlias: aliasInputs[0]?.rut ?? null,
        businessName: aliasInputs[0]?.businessName ?? null,
        aliases: { create: aliasInputs },
      },
      include: { aliases: { orderBy: { createdAt: "asc" } } },
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
