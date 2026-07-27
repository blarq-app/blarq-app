import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    // Partial update: only set fields that were explicitly passed.
    // Lets callers update description without touching costs and vice versa.
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.category !== undefined) payload.category = data.category;
    // Compat: aceptar tanto descriptionCliente como description (legacy)
    if (data.descriptionCliente !== undefined) payload.descriptionCliente = data.descriptionCliente;
    else if (data.description !== undefined) payload.descriptionCliente = data.description;
    if (data.descriptionMaestro !== undefined) payload.descriptionMaestro = data.descriptionMaestro;
    if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
    if (data.unit !== undefined) payload.unit = data.unit;
    if (data.unitPrice !== undefined) payload.unitPrice = data.unitPrice ?? 0;
    if (data.costMaterial !== undefined) payload.costMaterial = data.costMaterial ?? 0;
    if (data.costLabor !== undefined) payload.costLabor = data.costLabor ?? 0;
    if (data.costTools !== undefined) payload.costTools = data.costTools ?? 0;
    if (data.costMargin !== undefined) payload.costMargin = data.costMargin ?? 0;
    if (data.costLoss !== undefined) payload.costLoss = data.costLoss ?? 0;
    if (data.costSubcontract !== undefined) payload.costSubcontract = data.costSubcontract ?? 0;

    const partida = await prisma.partidaCatalog.update({
      where: { id },
      data: payload,
    });

    // Regla MJ (2026-06-06): mandar al catálogo es manual y NO propaga solo a
    // otras cotizaciones. Actualizar la partida acá toca SOLO el molde del
    // catálogo (la biblioteca). Las cotizaciones en borrador quedan quietas;
    // si MJ quiere ese cambio en una cotización, lo trae desde el panel
    // "Actualizar" del editor, eligiendo cambio por cambio. Antes esto
    // propagaba a todos los borradores y arrastraba cotizaciones a valores
    // que MJ no había decidido (el enredo de Constanza).
    //
    // Se mantiene `_propagated` en cero por compatibilidad con el caller.
    return NextResponse.json({
      ...partida,
      _propagated: { obraItemsUpdated: 0, budgetVersionsAffected: 0 },
    });
  } catch (error) {
    console.error("Error updating partida:", error);
    return NextResponse.json({ error: "Error al actualizar partida" }, { status: 500 });
  }
}

// Dónde está usada esta partida del catálogo. Lo consulta la pantalla ANTES de
// borrar, para poder avisar con números concretos ("está en 3 presupuestos de
// Sena y Candelaria") en vez de un cartel genérico.
async function usoDeLaPartida(id: string) {
  const items = await prisma.obraItem.findMany({
    where: { catalogPartidaId: id },
    select: {
      id: true,
      budgetVersion: {
        select: {
          id: true,
          version: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  });

  const versiones = new Set(items.map((i) => i.budgetVersion.id));
  // Nombres de proyecto sin repetir, en orden de aparición.
  const proyectos: string[] = [];
  for (const i of items) {
    const nombre = i.budgetVersion.project?.name;
    if (nombre && !proyectos.includes(nombre)) proyectos.push(nombre);
  }

  return {
    obraItems: items.length,
    presupuestos: versiones.size,
    proyectos,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const partida = await prisma.partidaCatalog.findUnique({
      where: { id },
      select: { id: true, name: true, category: true },
    });
    if (!partida) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ...partida, uso: await usoDeLaPartida(id) });
  } catch (error) {
    console.error("Error reading partida:", error);
    return NextResponse.json({ error: "Error al leer partida" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const forzar = request.nextUrl.searchParams.get("forzar") === "1";

    const uso = await usoDeLaPartida(id);

    // Sin `forzar`, seguimos frenando: es la red de seguridad para cualquier
    // otro llamador que borre sin avisar. La pantalla del catálogo consulta el
    // uso primero, muestra la advertencia y recién ahí manda `forzar=1`.
    if (uso.obraItems > 0 && !forzar) {
      const partida = await prisma.partidaCatalog.findUnique({
        where: { id },
        select: { name: true },
      });
      return NextResponse.json(
        {
          error:
            `Esta partida ${partida ? `("${partida.name}") ` : ""}está en uso en ${uso.presupuestos} presupuesto${uso.presupuestos === 1 ? "" : "s"}. ` +
            `Confirmá el borrado para desvincularla, o duplicala si necesitás una variante.`,
          uso,
        },
        { status: 409 }
      );
    }

    // Borrar la partida del catálogo NO rompe ningún presupuesto: cada ObraItem
    // guarda su propia copia (nombre, precios y sus ObraItemComponent). El
    // `catalogPartidaId` es solo el hilo que habilita "actualizar desde el
    // catálogo". Antes de borrar cortamos ese hilo para no dejar referencias
    // colgando apuntando a una partida que ya no existe.
    const componentes = await prisma.partidaComponent.findMany({
      where: { partidaId: id },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.obraItem.updateMany({
        where: { catalogPartidaId: id },
        data: { catalogPartidaId: null },
      }),
      // Marcas de "este componente del catálogo lo descarté" que apuntaban a
      // componentes que están por desaparecer. No son FK real, así que hay que
      // limpiarlas a mano para no dejar basura que confunda a un ObraItem si
      // después se lo re-vincula a otra partida.
      prisma.obraItemDiscardedCatalogComponent.deleteMany({
        where: { partidaComponentId: { in: componentes.map((c) => c.id) } },
      }),
      // Los PartidaComponent se van solos (onDelete: Cascade).
      prisma.partidaCatalog.delete({ where: { id } }),
    ]);

    return NextResponse.json({ ok: true, desvinculados: uso.obraItems });
  } catch (error) {
    console.error("Error deleting partida:", error);
    return NextResponse.json({ error: "Error al eliminar partida" }, { status: 500 });
  }
}
