/**
 * Entrega una foto del cajón de fotos (2026-09-27).
 *
 * GET /api/fotos/<id>
 *
 * Las líneas de artefactos, el catálogo y los herrajes guardan en `imageUrl`
 * un link a esta ruta en vez del link a la tienda (ver el modelo `FotoGuardada`
 * y `lib/fotos/guardarFoto.ts`). Como el contenido de un id nunca cambia (una
 * foto nueva es otra fila), el navegador la guarda sin fecha de vencimiento:
 * cada foto se baja una sola vez por computador.
 *
 * Como toda ruta /api, exige sesión (ADR 2026-06-15). El PDF no pasa por acá:
 * lleva las fotos incrustadas.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) {
    return new NextResponse("id inválido", { status: 400 });
  }
  try {
    const foto = await prisma.fotoGuardada.findUnique({
      where: { id },
      select: { mime: true, bytes: true },
    });
    if (!foto) return new NextResponse("no encontrada", { status: 404 });
    return new NextResponse(new Uint8Array(foto.bytes), {
      status: 200,
      headers: {
        "Content-Type": foto.mime,
        // "private": la ruta exige sesión, así que ningún intermediario
        // compartido debe guardarla. "immutable": el id nunca cambia de foto.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error entregando foto guardada:", error);
    return new NextResponse("error al leer la foto", { status: 500 });
  }
}
