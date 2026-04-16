import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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

    // Partidas con link a catálogo
    const catalogIds = budget.obraItems
      .map((i) => i.catalogPartidaId)
      .filter((x): x is string => !!x);

    const components = await prisma.partidaComponent.findMany({
      where: { partidaId: { in: catalogIds }, type: "material" },
      include: { material: true },
    });

    // Agrupar componentes por partida
    const compsByPartida = new Map<string, typeof components>();
    for (const c of components) {
      if (!compsByPartida.has(c.partidaId)) compsByPartida.set(c.partidaId, []);
      compsByPartida.get(c.partidaId)!.push(c);
    }

    // Agregar: key = materialId || normalized(name+unit)
    type Agg = {
      key: string;
      name: string;
      unit: string;
      materialId: string | null;
      qtyNeeded: number;
    };
    const agg = new Map<string, Agg>();

    for (const obraItem of budget.obraItems) {
      if (!obraItem.catalogPartidaId) continue;
      const comps = compsByPartida.get(obraItem.catalogPartidaId) || [];
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

    const itemsWithoutCatalog = budget.obraItems.filter(
      (i) => !i.catalogPartidaId
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
