import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Duplica una partida completa (con su snapshot de componentes). Se usa para
// partir partidas mixtas en dos zonas distintas — MJ duplica, edita la
// cantidad de cada lado y le pone subChapter a cada una. La nueva partida
// hereda todo (incluido el subChapter actual): la idea es que la copia salga
// idéntica y MJ después edite lo que tenga que cambiar.
//
// IMPORTANTE: la copia recibe un lineageId NUEVO (no el del origen). Aunque
// conceptualmente "es la misma partida repartida", el Estado de Pago exige
// lineageId único por EP (@@unique[estadoPagoId, lineageId]); si las dos
// mitades comparten lineageId, crear el EP revienta. Cada zona es una línea
// propia de acá en adelante.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId, itemId } = await params;

    const source = await prisma.obraItem.findUnique({
      where: { id: itemId },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (!source || source.budgetVersionId !== budgetVersionId) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }

    // sortOrder = siguiente global. El orden visible se reasigna en el
    // editor por subChapter + nombre, así que el sortOrder solo importa
    // para la persistencia y queries internas.
    const last = await prisma.obraItem.findFirst({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? -1) + 1;

    const dup = await prisma.obraItem.create({
      data: {
        budgetVersionId,
        // lineageId nuevo (default cuid): la copia es una línea separada.
        // Ver nota arriba — compartirlo rompe la creación de Estado de Pago.
        chapter: source.chapter,
        subChapter: source.subChapter,
        itemNumber: source.itemNumber,
        name: source.name,
        descriptionCliente: source.descriptionCliente,
        descriptionMaestro: source.descriptionMaestro,
        unit: source.unit,
        quantity: source.quantity,
        unitPrice: source.unitPrice,
        total: source.total,
        costMaterial: source.costMaterial,
        costLabor: source.costLabor,
        costSubcontract: source.costSubcontract,
        costMargin: source.costMargin,
        costTools: source.costTools,
        costLoss: source.costLoss,
        sortOrder: nextSortOrder,
        catalogPartidaId: source.catalogPartidaId,
        isCustomized: true, // al duplicar, la copia es "tuya" — no la pisa el sync de catálogo
      },
    });

    // Replicar componentes con dos pasadas para resolver appliedToComponentId
    if (source.components.length > 0) {
      const idMap = new Map<string, string>();
      const created: Array<{ source: typeof source.components[number]; newId: string }> = [];
      for (const c of source.components) {
        const newComp = await prisma.obraItemComponent.create({
          data: {
            obraItemId: dup.id,
            type: c.type,
            description: c.description,
            unit: c.unit,
            quantity: c.quantity,
            unitCost: c.unitCost,
            totalCost: c.totalCost,
            referenceLink: c.referenceLink,
            materialId: c.materialId,
            sortOrder: c.sortOrder,
            appliedToType: c.appliedToType,
            originComponentId: c.originComponentId,
          },
        });
        idMap.set(c.id, newComp.id);
        created.push({ source: c, newId: newComp.id });
      }
      for (const { source: c, newId } of created) {
        if (c.appliedToComponentId) {
          const target = idMap.get(c.appliedToComponentId);
          if (target) {
            await prisma.obraItemComponent.update({
              where: { id: newId },
              data: { appliedToComponentId: target },
            });
          }
        }
      }
    }

    return NextResponse.json(dup);
  } catch (error) {
    console.error("Error duplicating obra item:", error);
    return NextResponse.json(
      { error: "Error al duplicar partida" },
      { status: 500 }
    );
  }
}
