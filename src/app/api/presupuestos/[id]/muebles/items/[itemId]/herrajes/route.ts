/**
 * Líneas de herraje de una partida HERRAJES (MuebleItem.kind="herrajes").
 *
 * POST /api/presupuestos/{id}/muebles/items/{itemId}/herrajes
 *   Agrega un herraje a la partida. Body:
 *     { catalogId?, sector, quantity, supplier?, name?, measure?, finish?, sku?, costNet? }
 *   Si viene `catalogId`, el costo y los datos se snapshotean DEL CATÁLOGO (el
 *   cliente no puede falsear el precio). Si no, se usan los campos del body
 *   (carga a mano). Marca el item como kind="herrajes" y recalcula sus totales.
 */
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { recomputeAndPersistHerrajeItem } from "@/lib/presupuesto/muebleHerrajes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const data = await request.json();

    const item = await prisma.muebleItem.findUnique({ where: { id: itemId } });
    if (!item) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }

    // Snapshot: si viene del catálogo, los datos autoritativos salen de ahí.
    const snap: {
      catalogId: string | null;
      supplier: string;
      name: string;
      measure: string | null;
      finish: string | null;
      sku: string | null;
      costNet: number;
    } = {
      catalogId: null,
      supplier: typeof data.supplier === "string" ? data.supplier : "",
      name: typeof data.name === "string" ? data.name : "",
      measure: typeof data.measure === "string" ? data.measure : null,
      finish: typeof data.finish === "string" ? data.finish : null,
      sku: typeof data.sku === "string" ? data.sku : null,
      costNet: Number(data.costNet) || 0,
    };
    if (data.catalogId) {
      const cat = await prisma.herrajeCatalog.findUnique({
        where: { id: data.catalogId },
      });
      if (!cat) {
        return NextResponse.json(
          { error: "Herraje de catálogo no encontrado" },
          { status: 404 },
        );
      }
      snap.catalogId = cat.id;
      snap.supplier = cat.supplier;
      snap.name = cat.name;
      snap.measure = cat.measure;
      snap.finish = cat.finish;
      snap.sku = cat.sku;
      snap.costNet = cat.costNet;
    }
    if (!snap.name || !snap.supplier) {
      return NextResponse.json(
        { error: "Falta nombre o proveedor del herraje" },
        { status: 400 },
      );
    }

    const last = await prisma.muebleHerraje.findFirst({
      where: { itemId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSort = (last?.sortOrder ?? -1) + 1;

    const line = await prisma.muebleHerraje.create({
      data: {
        itemId,
        catalogId: snap.catalogId,
        sector: typeof data.sector === "string" ? data.sector.trim() : "",
        supplier: snap.supplier,
        name: snap.name,
        measure: snap.measure,
        finish: snap.finish,
        sku: snap.sku,
        quantity: Number(data.quantity) > 0 ? Number(data.quantity) : 1,
        costNet: snap.costNet,
        sortOrder: nextSort,
      },
    });

    // La partida pasa a ser de herrajes (su costo lo manejan las líneas) y se
    // recalcula. Mantenemos quantity=1: las cantidades reales van por línea.
    if (item.kind !== "herrajes") {
      await prisma.muebleItem.update({
        where: { id: itemId },
        data: { kind: "herrajes", quantity: 1 },
      });
    }
    const updatedItem = await recomputeAndPersistHerrajeItem(itemId);

    return NextResponse.json({ line, item: updatedItem });
  } catch (error) {
    console.error("Error agregando herraje a la partida:", error);
    return NextResponse.json(
      { error: "Error al agregar herraje" },
      { status: 500 },
    );
  }
}
