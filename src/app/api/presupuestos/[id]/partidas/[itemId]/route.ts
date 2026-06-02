import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Devuelve los totales actuales de la partida. Lo usa el editor para refrescar
// los campos de arriba (Material/Mano de obra/Margen/total) después de editar
// el detalle de componentes, sin recargar toda la página.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const item = await prisma.obraItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        quantity: true,
        unitPrice: true,
        total: true,
        costMaterial: true,
        costLabor: true,
        costTools: true,
        costSubcontract: true,
        costLoss: true,
        costMargin: true,
      },
    });
    if (!item) {
      return NextResponse.json({ error: "Ítem no encontrado" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("Error leyendo partida:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const data = await request.json();

    const total = (data.quantity || 0) * (data.unitPrice || 0);

    // Antes del update: leer el costLabor previo y los componentes
    // para poder sincronizar JORNAL si la M.O. cambió desde inline.
    const prev = await prisma.obraItem.findUnique({
      where: { id: itemId },
      select: { costLabor: true },
    });

    // subChapter (zona) es opcional: solo lo escribimos si vino en el payload.
    // `undefined` → no tocar el campo; `null` o `""` → limpiar.
    const subChapterUpdate =
      data.subChapter === undefined
        ? {}
        : { subChapter: data.subChapter === "" ? null : data.subChapter };

    const item = await prisma.obraItem.update({
      where: { id: itemId },
      data: {
        name: data.name,
        descriptionCliente: data.descriptionCliente ?? data.description,
        descriptionMaestro: data.descriptionMaestro,
        unit: data.unit,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        total,
        costMaterial: data.costMaterial,
        costLabor: data.costLabor,
        costSubcontract: data.costSubcontract,
        costMargin: data.costMargin,
        costTools: data.costTools,
        costLoss: data.costLoss,
        sortOrder: data.sortOrder,
        ...subChapterUpdate,
        isCustomized: true,
      },
    });

    // Si la M.O. cambió por edición inline, sincronizar el componente
    // base de mano_obra (JORNAL — el que NO es % de otros) en el snapshot
    // del proyecto. Así el desglose de costos visible al editar la partida
    // refleja el nuevo valor en vez de quedarse con el antiguo. Las leyes
    // sociales (% sobre M.O.) recalculan solas al ser un %.
    const newLabor = data.costLabor ?? 0;
    if (prev && Math.abs((prev.costLabor ?? 0) - newLabor) > 0.5) {
      const components = await prisma.obraItemComponent.findMany({
        where: { obraItemId: itemId, type: "mano_obra" },
        orderBy: { sortOrder: "asc" },
      });
      // Buscar el componente base (sin appliedTo — no es % de algo).
      const base = components.find(
        (c) => !c.appliedToComponentId && !c.appliedToType
      );
      if (base) {
        // Mantener qty (1 típicamente), cambiar unitCost y totalCost.
        const newTotalCost = base.quantity * newLabor;
        await prisma.obraItemComponent.update({
          where: { id: base.id },
          data: { unitCost: newLabor, totalCost: newTotalCost },
        });
      }
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating obra item:", error);
    return NextResponse.json(
      { error: "Error al actualizar partida" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    await prisma.obraItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting obra item:", error);
    return NextResponse.json(
      { error: "Error al eliminar partida" },
      { status: 500 }
    );
  }
}
