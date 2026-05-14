import { prisma } from "@/lib/prisma";
import { syncMaterialToComponents } from "@/lib/catalog/syncMaterial";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    const material = await prisma.materialCatalog.update({
      where: { id },
      data: {
        name: data.name?.toUpperCase()?.trim(),
        unit: data.unit,
        netPrice: data.netPrice,
        isProvision: data.isProvision ?? undefined,
        referenceLink: data.referenceLink || null,
      },
    });

    // Sync automático al catálogo de partidas: cuando MJ actualiza un
    // material acá, se propaga a TODOS los PartidaComponent que lo usen
    // (description / unit / netPrice / referenceLink) y se recalculan
    // los totales de cada partida afectada.
    //
    // NO toca presupuestos automáticamente — eso es manual desde
    // /configuracion/auditoria-precios (para evitar sorpresas en cotis
    // que MJ todavía no entregó).
    const syncSummary = await syncMaterialToComponents(id, {
      propagateToBudgets: false,
    });

    return NextResponse.json({ ...material, _sync: syncSummary });
  } catch (error) {
    console.error("Error updating material:", error);
    return NextResponse.json(
      { error: "Error al actualizar material" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.materialCatalog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting material:", error);
    return NextResponse.json(
      { error: "Error al eliminar material" },
      { status: 500 }
    );
  }
}
