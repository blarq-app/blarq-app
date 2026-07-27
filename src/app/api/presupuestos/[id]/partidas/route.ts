import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Agregar partida de obra
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    // El capítulo destino tiene que ser uno de ESTA versión.
    const chapterId = String(data.chapterId ?? "");
    const chapter = await prisma.obraChapter.findFirst({
      where: { id: chapterId, budgetVersionId },
      select: { id: true, sortOrder: true },
    });
    if (!chapter) {
      return NextResponse.json(
        { error: "Capítulo no encontrado en este presupuesto" },
        { status: 400 }
      );
    }

    // itemNumber es legacy — lo que se muestra en pantalla y en el PDF es un
    // correlativo recalculado al vuelo (lib/presupuesto/chapters.ts). Lo
    // seguimos escribiendo con algo coherente para no dejar el campo vacío.
    const existingItems = await prisma.obraItem.count({
      where: { budgetVersionId, chapterId: chapter.id },
    });
    const itemNumber = `${chapter.sortOrder + 1}.${existingItems + 1}`;

    // Calcular el siguiente sortOrder global
    const allItems = await prisma.obraItem.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSortOrder = allItems.length > 0 ? allItems[0].sortOrder + 1 : 0;

    const total = (data.quantity || 0) * (data.unitPrice || 0);

    // isCustomized: true si la partida no viene del catálogo (creada manual);
    // false si viene del catálogo (sus precios/datos pueden refrescarse luego).
    const fromCatalog = !!data.catalogPartidaId;

    const item = await prisma.obraItem.create({
      data: {
        budgetVersionId,
        chapterId: chapter.id,
        // Legacy: la columna vieja de texto. Se sigue escribiendo (vacía para
        // las partidas nuevas) hasta que se borre en un PR posterior.
        chapter: "",
        subChapter: data.subChapter || null,
        itemNumber,
        name: data.name,
        descriptionCliente: data.descriptionCliente ?? data.description ?? null,
        descriptionMaestro: data.descriptionMaestro ?? null,
        unit: data.unit || "GL",
        quantity: data.quantity || 0,
        unitPrice: data.unitPrice || 0,
        total,
        costMaterial: data.costMaterial || null,
        costLabor: data.costLabor || null,
        costSubcontract: data.costSubcontract || null,
        costMargin: data.costMargin || null,
        costTools: data.costTools || null,
        costLoss: data.costLoss || null,
        catalogPartidaId: data.catalogPartidaId || null,
        isCustomized: !fromCatalog,
        sortOrder: nextSortOrder,
      },
    });

    // Snapshot de componentes desde el catálogo (regla MJ 2026-05-05:
    // los componentes del proyecto deben ser inmutables ante cambios al
    // catálogo). Cada ObraItem tiene su propia copia de los componentes.
    if (fromCatalog && data.catalogPartidaId) {
      const catalogComps = await prisma.partidaComponent.findMany({
        where: { partidaId: data.catalogPartidaId },
        orderBy: { sortOrder: "asc" },
      });
      // Mapeo viejo→nuevo para resolver appliedToComponentId
      const idMap = new Map<string, string>();
      const created: Array<{ source: typeof catalogComps[number]; newId: string }> = [];
      for (const c of catalogComps) {
        const newComp = await prisma.obraItemComponent.create({
          data: {
            obraItemId: item.id,
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
            // Guardamos el origen para que el sync diferencial sepa qué
            // componente del catálogo corresponde a qué componente del
            // proyecto. Permite agregar faltantes y borrar los huérfanos
            // sin matching por descripción/tipo.
            originComponentId: c.id,
          },
        });
        idMap.set(c.id, newComp.id);
        created.push({ source: c, newId: newComp.id });
      }
      // Segunda pasada: resolver appliedToComponentId con los nuevos IDs
      for (const { source, newId } of created) {
        if (source.appliedToComponentId) {
          const target = idMap.get(source.appliedToComponentId);
          if (target) {
            await prisma.obraItemComponent.update({
              where: { id: newId },
              data: { appliedToComponentId: target },
            });
          }
        }
      }
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating obra item:", error);
    return NextResponse.json(
      { error: "Error al crear partida" },
      { status: 500 }
    );
  }
}

// Actualizar múltiples partidas (bulk update)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    await params; // consume params
    const { items } = await request.json();

    // Cualquier edit a una partida la marca como customizada — habilita
    // distinguirla del estado original del catálogo a futuro (refresh-from-catalog).
    const updated = [];
    for (const item of items) {
      const total = (item.quantity || 0) * (item.unitPrice || 0);
      const result = await prisma.obraItem.update({
        where: { id: item.id },
        data: {
          name: item.name,
          descriptionCliente: item.descriptionCliente ?? item.description,
          descriptionMaestro: item.descriptionMaestro,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total,
          costMaterial: item.costMaterial,
          costLabor: item.costLabor,
          costSubcontract: item.costSubcontract,
          costMargin: item.costMargin,
          costTools: item.costTools,
          costLoss: item.costLoss,
          sortOrder: item.sortOrder,
          isCustomized: true,
        },
      });
      updated.push(result);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating obra items:", error);
    return NextResponse.json(
      { error: "Error al actualizar partidas" },
      { status: 500 }
    );
  }
}
