import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import {
  aggregateShoppingItems,
  countItemsWithoutMaterial,
} from "@/lib/listaCompra/perdidaCantidad";
import { selectVigente } from "@/lib/projects/selectVersion";

// Recalcula qtyNeeded agregando componentes de tipo "material" de cada partida
// de la versión de obra VIGENTE (la más reciente entre enviada y aprobada;
// ver src/lib/projects/selectVersion.ts).
// - Agrega/actualiza items NO manuales por (materialId) o (name+unit).
// - Preserva qtyBought y notas.
// - Items manuales quedan intactos.
// - Items no-manuales que dejan de aparecer en el presupuesto se dejan con qtyNeeded = 0
//   (no se eliminan para conservar qtyBought ya registrado).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: projectId } = await params;

    // Antes acá había dos consultas encadenadas: primero la aprobada más
    // reciente y, si no había ninguna, la más reciente de cualquier estado.
    // Eso dejaba la sincronización pegada en una versión aprobada vieja aunque
    // ya hubiera una versión nueva enviada. Ahora es el criterio único.
    const versions = await prisma.budgetVersion.findMany({
      where: { projectId, type: "obra" },
      select: { id: true, status: true, createdAt: true },
    });
    const budget = selectVigente(versions);

    if (!budget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra" },
        { status: 400 }
      );
    }

    // Lee componentes del SNAPSHOT del proyecto (ObraItemComponent), NO
    // del catálogo (PartidaComponent). Regla MJ 2026-05-05: el ppto
    // aprobado es inmutable ante cambios al catálogo.
    // Trae TODOS los componentes: la merma necesita ver las líneas de pérdida
    // para inflar la cantidad. Ver src/lib/listaCompra/perdidaCantidad.ts.
    const obraItemsWithComps = await prisma.obraItem.findMany({
      where: { budgetVersionId: budget.id },
      include: {
        components: { include: { material: true } },
      },
    });

    // La cantidad incluye la pérdida (merma) del material al que esté enganchada.
    const agg = aggregateShoppingItems(obraItemsWithComps, true);

    // Existing items (no manuales)
    const existing = await prisma.shoppingItem.findMany({
      where: { projectId, manualAdd: false },
    });

    const byKey = new Map<string, (typeof existing)[number]>();
    for (const e of existing) {
      const k = e.materialId
        ? `mat:${e.materialId}`
        : `name:${e.name.trim().toLowerCase()}|${e.unit.trim().toLowerCase()}`;
      byKey.set(k, e);
    }

    let added = 0;
    let updated = 0;
    let zeroed = 0;
    let sort = 0;

    // Upsert
    for (const a of agg.values()) {
      const prev = byKey.get(a.key);
      if (prev) {
        await prisma.shoppingItem.update({
          where: { id: prev.id },
          data: {
            name: a.name,
            unit: a.unit,
            materialId: a.materialId,
            qtyNeeded: a.qtyNeeded,
          },
        });
        updated++;
        byKey.delete(a.key);
      } else {
        await prisma.shoppingItem.create({
          data: {
            projectId,
            name: a.name,
            unit: a.unit,
            materialId: a.materialId,
            qtyNeeded: a.qtyNeeded,
            qtyBought: 0,
            manualAdd: false,
            sortOrder: sort++,
          },
        });
        added++;
      }
    }

    // Los que sobran en byKey ya no están en presupuesto → qtyNeeded=0
    for (const leftover of byKey.values()) {
      await prisma.shoppingItem.update({
        where: { id: leftover.id },
        data: { qtyNeeded: 0 },
      });
      zeroed++;
    }

    // Items sin materiales detallados (no se snapshotean = creados manual sin
    // catálogo origen, o partidas viejas sin migrar).
    const itemsWithoutCatalog = countItemsWithoutMaterial(
      obraItemsWithComps,
      false
    );

    return NextResponse.json({
      added,
      updated,
      zeroed,
      itemsWithoutCatalog,
    });
  } catch (error) {
    console.error("Error sync lista compra:", error);
    return NextResponse.json(
      { error: "Error al sincronizar" },
      { status: 500 }
    );
  }
}
