import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildPrevAccumulators, findLatestObraBudget } from "@/lib/ep/snapshot";
import { computeSyncDiff } from "@/lib/ep/sync";
import { requireSession } from "@/lib/apiAuth";

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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;

    let body: {
      targetVersionId?: string;
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
    if (ep.status === "cerrado") {
      return NextResponse.json(
        { error: "El EP está cerrado y no puede sincronizarse." },
        { status: 409 }
      );
    }

    // Versión destino: la elegida a mano (body.targetVersionId), validada como
    // obra de este proyecto; si no, la vigente. DEBE ser la misma que mostró el
    // preview, así que la UI manda el id que el usuario eligió.
    const obraBudget = body.targetVersionId
      ? await prisma.budgetVersion.findFirst({
          where: { id: body.targetVersionId, projectId: ep.projectId, type: "obra" },
          include: { obraItems: { orderBy: { sortOrder: "asc" } } },
        })
      : await findLatestObraBudget(prisma, ep.projectId);
    if (!obraBudget) {
      return NextResponse.json(
        { error: "No hay presupuesto de obra para sincronizar" },
        { status: 400 }
      );
    }

    // Si el EP es de un maestro, se sincroniza SOLO contra sus partidas de la
    // versión vigente — sino el sync le metería las partidas de los otros
    // maestros. Una partida reasignada a otro maestro sale de este alcance
    // (se comporta como "removida": outOfScope si tenía pagos, o se borra).
    const budgetItems = ep.maestroId
      ? obraBudget.obraItems.filter((it) => it.maestroId === ep.maestroId)
      : obraBudget.obraItems;

    const { prevAmountPaidByLineage } = await buildPrevAccumulators(prisma, {
      projectId: ep.projectId,
      maestroId: ep.maestroId,
      beforeNumber: ep.number,
    });

    const diff = computeSyncDiff(
      ep.items,
      budgetItems,
      prevAmountPaidByLineage
    );

    // Indexamos para resolver detalles al aplicar
    const epItemByLineage = new Map(ep.items.map((i) => [i.lineageId, i]));
    const budgetItemByLineage = new Map(
      budgetItems.map((b) => [b.lineageId, b])
    );
    const budgetIndexByLineage = new Map(
      budgetItems.map((b, idx) => [b.lineageId, idx])
    );

    let added = 0;
    let removed = 0;
    let markedOutOfScope = 0;
    let updatedCount = 0;
    let skippedAdded = 0;
    let skippedUpdated = 0;

    // 1) Eliminadas con pagos previos → marcar outOfScope si aceptado
    for (const r of diff.removedWithPayments) {
      if (acceptAll || acceptedOutOfScope.has(r.id)) {
        await prisma.estadoPagoItem.update({
          where: { id: r.id },
          data: { outOfScope: true },
        });
        markedOutOfScope++;
      }
    }

    // 2) Eliminadas sin pagos previos → borrar si aceptado
    for (const r of diff.removedSafe) {
      if (acceptAll || acceptedRemovedSafe.has(r.id)) {
        await prisma.estadoPagoItem.delete({ where: { id: r.id } });
        removed++;
      }
    }

    // 3) Lineages nuevos → crear si aceptado
    for (const a of diff.added) {
      if (!acceptAll && !acceptedAdds.has(a.lineageId)) {
        skippedAdded++;
        continue;
      }
      const b = budgetItemByLineage.get(a.lineageId)!;
      const idx = budgetIndexByLineage.get(a.lineageId) ?? 0;
      await prisma.estadoPagoItem.create({
        data: {
          chapter: b.chapter,
          subChapter: b.subChapter,
          itemNumber: b.itemNumber,
          name: b.name,
          descriptionMaestro: b.descriptionMaestro,
          unit: b.unit,
          quantity: b.quantity,
          laborUnitPrice: a.laborUnitPrice,
          laborTotal: a.laborTotal,
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
    }

    // 4) Modificadas → actualizar campos visibles si aceptado;
    //    refrescar pointer obraItemId silenciosamente si no.
    for (const u of diff.updated) {
      const existing = epItemByLineage.get(u.lineageId)!;
      const b = budgetItemByLineage.get(u.lineageId)!;
      const idx = budgetIndexByLineage.get(u.lineageId) ?? 0;
      const laborUnitPrice = b.costLabor ?? 0;
      const accepted = acceptAll || acceptedUpdates.has(existing.id);

      if (accepted) {
        const pct =
          b.quantity > 0
            ? (existing.quantityExecuted / b.quantity) * 100
            : 0;
        await prisma.estadoPagoItem.update({
          where: { id: existing.id },
          data: {
            obraItemId: b.id,
            chapter: b.chapter,
            subChapter: b.subChapter,
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
        if (existing.obraItemId !== b.id) {
          await prisma.estadoPagoItem.update({
            where: { id: existing.id },
            data: { obraItemId: b.id },
          });
        }
        skippedUpdated++;
      }
    }

    // 5) Sin cambios visibles pero el pointer obraItemId puede estar stale
    //    (V4 → V5 con datos idénticos). Refrescamos silenciosamente.
    for (const b of budgetItems) {
      const existing = epItemByLineage.get(b.lineageId);
      if (!existing) continue;
      // ya procesado en updated/added
      if (diff.updated.some((u) => u.lineageId === b.lineageId)) continue;
      if (existing.obraItemId !== b.id) {
        await prisma.estadoPagoItem.update({
          where: { id: existing.id },
          data: { obraItemId: b.id },
        });
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
