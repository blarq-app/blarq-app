import { prisma } from "@/lib/prisma";
import { syncMaterialToComponents } from "@/lib/catalog/syncMaterial";
import { fetchPriceFromUrl } from "@/lib/catalog/fetchPrice";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    // Estado anterior para detectar cambio de link + decidir si auto-fetch.
    const previous = await prisma.materialCatalog.findUnique({
      where: { id },
      select: { referenceLink: true, netPrice: true },
    });

    const newLink = data.referenceLink || null;
    const linkChanged =
      newLink && newLink !== (previous?.referenceLink ?? null);
    // MJ no modificó el precio explícitamente si el netPrice del payload
    // coincide con el guardado. En ese caso, si el link cambió, intentamos
    // bajar el precio nuevo del sitio automático.
    const priceUntouched =
      data.netPrice === undefined ||
      Math.abs((data.netPrice ?? 0) - (previous?.netPrice ?? 0)) < 0.01;

    let fetched: Awaited<ReturnType<typeof fetchPriceFromUrl>> = null;
    let effectivePrice = data.netPrice;

    if (linkChanged && priceUntouched) {
      fetched = await fetchPriceFromUrl(newLink);
      if (fetched) {
        effectivePrice = fetched.netPrice;
      }
    }

    const material = await prisma.materialCatalog.update({
      where: { id },
      data: {
        name: data.name?.toUpperCase()?.trim(),
        unit: data.unit,
        netPrice: effectivePrice,
        isProvision: data.isProvision ?? undefined,
        referenceLink: newLink,
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

    return NextResponse.json({
      ...material,
      _sync: syncSummary,
      _autoFetchedPrice: fetched
        ? {
            source: fetched.source,
            priceIva: fetched.priceIva,
            netPrice: fetched.netPrice,
          }
        : linkChanged && priceUntouched
          ? { source: null, error: "no_se_pudo_obtener" }
          : null,
    });
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
