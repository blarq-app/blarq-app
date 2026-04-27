import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Devuelve el diff entre el EP actual y la versión más nueva del presupuesto
// SIN mutar nada. La UI lo usa para mostrar checkboxes y dejar que el usuario
// elija qué cambios aplicar.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: {
        items: true,
        budgetVersion: { select: { id: true, version: true } },
      },
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

    // Acumulado pagado en EPs cerrados anteriores → para detectar outOfScope con pago
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

    const existingByLineage = new Map(ep.items.map((i) => [i.lineageId, i]));
    const budgetLineages = new Set(obraBudget.obraItems.map((b) => b.lineageId));

    // Partidas presentes en el EP cuya identidad ya no aparece en el presupuesto nuevo
    const removedSafe: Array<{
      id: string;
      lineageId: string;
      chapter: string;
      itemNumber: string;
      name: string;
    }> = [];
    const removedWithPayments: Array<{
      id: string;
      lineageId: string;
      chapter: string;
      itemNumber: string;
      name: string;
      prevAmountPaid: number;
    }> = [];
    for (const s of ep.items) {
      if (budgetLineages.has(s.lineageId)) continue;
      const prevPaid = prevAmountPaidByLineage.get(s.lineageId) ?? 0;
      if (prevPaid > 0) {
        removedWithPayments.push({
          id: s.id,
          lineageId: s.lineageId,
          chapter: s.chapter,
          itemNumber: s.itemNumber,
          name: s.name,
          prevAmountPaid: prevPaid,
        });
      } else {
        removedSafe.push({
          id: s.id,
          lineageId: s.lineageId,
          chapter: s.chapter,
          itemNumber: s.itemNumber,
          name: s.name,
        });
      }
    }

    // Partidas en el presupuesto nuevo: agregadas o actualizadas
    const added: Array<{
      lineageId: string;
      chapter: string;
      itemNumber: string;
      name: string;
      descriptionMaestro: string | null;
      unit: string;
      quantity: number;
      laborUnitPrice: number;
      laborTotal: number;
    }> = [];
    const updated: Array<{
      id: string;
      lineageId: string;
      chapter: string;
      itemNumber: string;
      name: string;
      changes: Array<{
        field:
          | "name"
          | "descriptionMaestro"
          | "unit"
          | "quantity"
          | "laborUnitPrice"
          | "itemNumber"
          | "chapter";
        oldValue: string | number | null;
        newValue: string | number | null;
      }>;
    }> = [];
    let unchangedCount = 0;

    for (const b of obraBudget.obraItems) {
      const laborUnitPrice = b.costLabor ?? 0;
      const existing = existingByLineage.get(b.lineageId);

      if (!existing) {
        added.push({
          lineageId: b.lineageId,
          chapter: b.chapter,
          itemNumber: b.itemNumber,
          name: b.name,
          descriptionMaestro: b.descriptionMaestro,
          unit: b.unit,
          quantity: b.quantity,
          laborUnitPrice,
          laborTotal: laborUnitPrice * b.quantity,
        });
        continue;
      }

      const changes: Array<{
        field:
          | "name"
          | "descriptionMaestro"
          | "unit"
          | "quantity"
          | "laborUnitPrice"
          | "itemNumber"
          | "chapter";
        oldValue: string | number | null;
        newValue: string | number | null;
      }> = [];
      if (existing.chapter !== b.chapter)
        changes.push({ field: "chapter", oldValue: existing.chapter, newValue: b.chapter });
      if (existing.itemNumber !== b.itemNumber)
        changes.push({
          field: "itemNumber",
          oldValue: existing.itemNumber,
          newValue: b.itemNumber,
        });
      if (existing.name !== b.name)
        changes.push({ field: "name", oldValue: existing.name, newValue: b.name });
      if ((existing.descriptionMaestro ?? null) !== (b.descriptionMaestro ?? null))
        changes.push({
          field: "descriptionMaestro",
          oldValue: existing.descriptionMaestro,
          newValue: b.descriptionMaestro,
        });
      if (existing.unit !== b.unit)
        changes.push({ field: "unit", oldValue: existing.unit, newValue: b.unit });
      if (existing.quantity !== b.quantity)
        changes.push({
          field: "quantity",
          oldValue: existing.quantity,
          newValue: b.quantity,
        });
      if (existing.laborUnitPrice !== laborUnitPrice)
        changes.push({
          field: "laborUnitPrice",
          oldValue: existing.laborUnitPrice,
          newValue: laborUnitPrice,
        });

      if (changes.length === 0) {
        unchangedCount++;
      } else {
        updated.push({
          id: existing.id,
          lineageId: existing.lineageId,
          chapter: existing.chapter,
          itemNumber: existing.itemNumber,
          name: existing.name,
          changes,
        });
      }
    }

    return NextResponse.json({
      currentVersion: ep.budgetVersion
        ? { id: ep.budgetVersion.id, version: ep.budgetVersion.version }
        : null,
      targetVersion: { id: obraBudget.id, version: obraBudget.version },
      added,
      removedSafe,
      removedWithPayments,
      updated,
      unchangedCount,
    });
  } catch (error) {
    console.error("Error sync preview EP:", error);
    return NextResponse.json(
      { error: "Error al previsualizar sincronización" },
      { status: 500 }
    );
  }
}
