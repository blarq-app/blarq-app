import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Sincroniza los items del EP con el presupuesto de obra más reciente.
// Matchea partidas por `lineageId` (identidad estable a través de versiones).
// Acepta opcionalmente una `selection` para aplicar solo cambios específicos:
//   {
//     selection?: {
//       addedLineageIds?: string[]     // lineages nuevos a crear; si no viene la selection → aplicar todo
//       removedSafeItemIds?: string[]  // EP item ids sin pagos previos a borrar
//       outOfScopeItemIds?: string[]   // EP item ids con pagos previos a marcar outOfScope
//       updatedItemIds?: string[]      // EP item ids cuyos cambios se aceptan
//     }
//   }
// Si no se manda body o `selection` es undefined, se aplican TODOS los cambios.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let body: {
      selection?: {
        addedLineageIds?: string[];
        removedSafeItemIds?: string[];
        outOfScopeItemIds?: string[];
        updatedItemIds?: string[];
      };
    } = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      // body vacío o malformado → aplicar todo
    }
    const selection = body.selection;
    const acceptAll = !selection;

    const acceptedAdds = new Set(selection?.addedLineageIds ?? []);
    const acceptedRemovedSafe = new Set(selection?.removedSafeItemIds ?? []);
    const acceptedOutOfScope = new Set(selection?.outOfScopeItemIds ?? []);
    const acceptedUpdates = new Set(selection?.updatedItemIds ?? []);

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!ep) {
      return NextResponse.json({ error: "EP no encontrado" }, { status: 404 });
    }

    const obraBudget =
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra", status: "aprobado" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      })) ||
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra" },
        orderBy: { createdAt: "desc" },
        include: { obraItems: { orderBy: { sortOrder: "asc" } } },
      }));

    if (!obraBudget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra para sincronizar" },
        { status: 400 }
      );
    }

    if (ep.status === "cerrado") {
      return NextResponse.json(
        { error: "El EP está cerrado y no puede sincronizarse." },
        { status: 409 }
      );
    }

    // ── Acumulado pagado en EPs CERRADOS anteriores (para detectar outOfScope con pago) ──
    const prevClosedEps = await prisma.estadoPago.findMany({
      where: {
        projectId: ep.projectId,
        status: "cerrado",
        number: { lt: ep.number },
      },
      include: { items: true },
    });
    const prevAmountPaidByLineage = new Map<string, number>();
    for (const prev of prevClosedEps) {
      for (const it of prev.items) {
        const cur = prevAmountPaidByLineage.get(it.lineageId) ?? 0;
        prevAmountPaidByLineage.set(it.lineageId, cur + (it.amountPaid ?? 0));
      }
    }

    // Map existing EP items por lineageId (identidad estable)
    const existingByLineage = new Map(ep.items.map((i) => [i.lineageId, i]));
    const budgetLineages = new Set(obraBudget.obraItems.map((b) => b.lineageId));

    // 1) Items del EP cuya identidad ya no aparece en el presupuesto nuevo
    const stale = ep.items.filter((i) => !budgetLineages.has(i.lineageId));
    let removed = 0;
    let markedOutOfScope = 0;
    for (const s of stale) {
      const hadPayments = (prevAmountPaidByLineage.get(s.lineageId) ?? 0) > 0;
      if (hadPayments) {
        if (acceptAll || acceptedOutOfScope.has(s.id)) {
          await prisma.estadoPagoItem.update({
            where: { id: s.id },
            data: { outOfScope: true },
          });
          markedOutOfScope++;
        }
      } else {
        if (acceptAll || acceptedRemovedSafe.has(s.id)) {
          await prisma.estadoPagoItem.delete({ where: { id: s.id } });
          removed++;
        }
      }
    }

    // 2) Por cada partida actual del presupuesto: agregar o actualizar
    let added = 0;
    let updatedCount = 0;
    let skippedAdded = 0;
    let skippedUpdated = 0;
    for (let idx = 0; idx < obraBudget.obraItems.length; idx++) {
      const b = obraBudget.obraItems[idx];
      const laborUnitPrice = b.costLabor ?? 0;
      const existing = existingByLineage.get(b.lineageId);

      if (!existing) {
        // Partida con lineage nuevo → respetar selección
        if (!acceptAll && !acceptedAdds.has(b.lineageId)) {
          skippedAdded++;
          continue;
        }
        await prisma.estadoPagoItem.create({
          data: {
            chapter: b.chapter,
            itemNumber: b.itemNumber,
            name: b.name,
            descriptionMaestro: b.descriptionMaestro,
            unit: b.unit,
            quantity: b.quantity,
            laborUnitPrice,
            laborTotal: laborUnitPrice * b.quantity,
            outOfScope: false,
            sortOrder: b.sortOrder ?? idx,
            estadoPagoId: ep.id,
            obraItemId: b.id,
            lineageId: b.lineageId,
            quantityExecuted: 0,
            pctAccumulated: 0,
          },
        });
        added++;
        continue;
      }

      // Partida existente → ¿hay diferencias visibles para el usuario?
      // (el obraItemId se refresca siempre por separado, no es parte de la diff)
      const hasChanges =
        existing.chapter !== b.chapter ||
        existing.itemNumber !== b.itemNumber ||
        existing.name !== b.name ||
        (existing.descriptionMaestro ?? null) !== (b.descriptionMaestro ?? null) ||
        existing.unit !== b.unit ||
        existing.quantity !== b.quantity ||
        existing.laborUnitPrice !== laborUnitPrice;

      const accepted = acceptAll || acceptedUpdates.has(existing.id);

      if (hasChanges && accepted) {
        const pct =
          b.quantity > 0
            ? (existing.quantityExecuted / b.quantity) * 100
            : 0;
        await prisma.estadoPagoItem.update({
          where: { id: existing.id },
          data: {
            obraItemId: b.id,
            chapter: b.chapter,
            itemNumber: b.itemNumber,
            name: b.name,
            descriptionMaestro: b.descriptionMaestro,
            unit: b.unit,
            quantity: b.quantity,
            laborUnitPrice,
            laborTotal: laborUnitPrice * b.quantity,
            outOfScope: false,
            sortOrder: b.sortOrder ?? idx,
            pctAccumulated: pct,
          },
        });
        updatedCount++;
      } else {
        // Sin cambios visibles, o el usuario los rechazó. De todos modos
        // refrescamos silenciosamente el pointer obraItemId si está stale,
        // para que apunte a la versión vigente del presupuesto.
        if (existing.obraItemId !== b.id) {
          await prisma.estadoPagoItem.update({
            where: { id: existing.id },
            data: { obraItemId: b.id },
          });
        }
        if (hasChanges && !accepted) skippedUpdated++;
      }
    }

    // Asociar EP a la versión vigente del presupuesto (siempre, para que el
    // badge desaparezca y futuras llamadas a /preview comparen contra esta
    // versión como nueva base)
    await prisma.estadoPago.update({
      where: { id },
      data: { budgetVersionId: obraBudget.id },
    });

    const updated = await prisma.estadoPago.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({
      ep: updated,
      added,
      removed,
      markedOutOfScope,
      updated: updatedCount,
      skippedAdded,
      skippedUpdated,
    });
  } catch (error) {
    console.error("Error sync EP:", error);
    return NextResponse.json(
      { error: "Error al sincronizar EP" },
      { status: 500 }
    );
  }
}
