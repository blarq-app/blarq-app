import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/reembolsadores/learn
 *
 * Endpoint usado por el modal de conciliación cuando MJ confirma
 * "recordar pagador frecuente". Aprende una regla sin pisar lo que ya
 * exista.
 *
 * Body:
 *   nombre?: string                    — solo se usa si hay que crear nuevo
 *   glosa: string                      — texto a matchear en mov.description
 *   alias: { rut: string; businessName?: string | null }
 *
 * Comportamiento:
 *   - Si existe un Reembolsador con esa glosa: le agrega el alias si no
 *     lo tiene ya. Si el alias ya existe, no-op (idempotente).
 *   - Si no existe: crea un Reembolsador nuevo con esa glosa + ese alias.
 *
 * Devuelve el Reembolsador resultante con su lista de aliases.
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const glosa = String(data?.glosa ?? "").trim().toLowerCase();
    const aliasRut = String(data?.alias?.rut ?? "").trim();
    const aliasBusinessName = data?.alias?.businessName
      ? String(data.alias.businessName).trim()
      : null;
    const nombrePropuesto = data?.nombre
      ? String(data.nombre).trim()
      : glosa.split(/\s+/)[0] ?? "Pagador";

    if (!glosa || !aliasRut) {
      return NextResponse.json(
        { error: "glosa y alias.rut son obligatorios" },
        { status: 400 }
      );
    }

    // ¿Existe ya un reembolsador con esta glosa?
    const existing = await prisma.reembolsador.findUnique({
      where: { glosa },
      include: { aliases: true },
    });

    if (existing) {
      // Idempotente: si el alias ya esta, no hacemos nada.
      const dup = existing.aliases.find(
        (a) => a.rut.replace(/\D/g, "") === aliasRut.replace(/\D/g, "")
      );
      if (!dup) {
        await prisma.reembolsadorAlias.create({
          data: {
            reembolsadorId: existing.id,
            rut: aliasRut,
            businessName: aliasBusinessName,
          },
        });
      }
      const refreshed = await prisma.reembolsador.findUnique({
        where: { id: existing.id },
        include: { aliases: { orderBy: { createdAt: "asc" } } },
      });
      return NextResponse.json({
        reembolsador: refreshed,
        created: false,
        aliasAdded: !dup,
      });
    }

    // Crear nuevo reembolsador con el alias.
    const created = await prisma.reembolsador.create({
      data: {
        nombre: nombrePropuesto.charAt(0).toUpperCase() + nombrePropuesto.slice(1),
        glosa,
        rutAlias: aliasRut, // legacy, mantenido por compat
        businessName: aliasBusinessName,
        aliases: {
          create: [{ rut: aliasRut, businessName: aliasBusinessName }],
        },
      },
      include: { aliases: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({
      reembolsador: created,
      created: true,
      aliasAdded: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al aprender";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
