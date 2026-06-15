import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Recalcula qtyNeeded agregando componentes de tipo "material" de cada partida
// del presupuesto de obra más reciente (aprobado si existe).
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

    const budget =
      (await prisma.budgetVersion.findFirst({
        where: { projectId, type: "obra", status: "aprobado" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: true },
      })) ||
      (await prisma.budgetVersion.findFirst({
        where: { projectId, type: "obra" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: true },
      }));

    if (!budget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra" },
        { status: 400 }
      );
    }

    // Lee componentes del SNAPSHOT del proyecto (ObraItemComponent), NO
    // del catálogo (PartidaComponent). Regla MJ 2026-05-05: el ppto
    // aprobado es inmutable ante cambios al catálogo.
    const obraItemsWithComps = await prisma.obraItem.findMany({
      where: { budgetVersionId: budget.id },
      include: {
        components: {
          where: { type: "material" },
          include: { material: true },
        },
      },
    });

    // Agregar: key = materialId || normalized(name+unit)
    type Agg = {
      key: string;
      name: string;
      unit: string;
      materialId: string | null;
      qtyNeeded: number;
    };
    const agg = new Map<string, Agg>();

    for (const obraItem of obraItemsWithComps) {
      const comps = obraItem.components;
      for (const c of comps) {
        const qty = (c.quantity || 0) * (obraItem.quantity || 0);
        if (qty <= 0) continue;
        const name = c.material?.name || c.description;
        const unit = c.material?.unit || c.unit;
        const key = c.materialId
          ? `mat:${c.materialId}`
          : `name:${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
        const prev = agg.get(key);
        if (prev) {
          prev.qtyNeeded += qty;
        } else {
          agg.set(key, {
            key,
            name,
            unit,
            materialId: c.materialId || null,
            qtyNeeded: qty,
          });
        }
      }
    }

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

    // Items sin componentes (no se snapshotean = creados manual sin
    // catálogo origen, o partidas viejas sin migrar).
    const itemsWithoutCatalog = obraItemsWithComps.filter(
      (i) => i.components.length === 0
    ).length;

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
