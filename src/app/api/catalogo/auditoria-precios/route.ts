/**
 * Auditoría de precios desactualizados.
 *
 * GET: lista componentes en presupuestos status="borrador" donde el
 *      ObraItemComponent.unitCost (o description) no coincide con el
 *      MaterialCatalog linkeado. Agrupado por proyecto + presupuesto.
 *      Solo retorna componentes que NO están marcados como isCustomized
 *      (esos los respetamos — MJ los editó a propósito).
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Si se pasa ?budgetId=xxx limitamos al presupuesto puntual (lo usa el
    // cartelito del editor de presupuesto). Sin parámetro, lista todos los
    // borradores con stale components (para la página /configuracion/auditoria-precios).
    const budgetId = request.nextUrl.searchParams.get("budgetId");

    // Solo borradores. Status enviado/aprobado/rechazado están congelados.
    const components = await prisma.obraItemComponent.findMany({
      where: {
        materialId: { not: null },
        isCustomized: false,
        obraItem: {
          budgetVersionId: budgetId ?? undefined,
          budgetVersion: { status: "borrador" },
        },
      },
      include: {
        material: true,
        obraItem: {
          select: {
            id: true,
            name: true,
            itemNumber: true,
            budgetVersion: {
              select: {
                id: true,
                version: true,
                date: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Detectar diff vs el material
    const stale = components.filter((c) => {
      if (!c.material) return false;
      return (
        c.description !== c.material.name ||
        Math.abs(c.unitCost - c.material.netPrice) > 0.01 ||
        (c.referenceLink ?? null) !== (c.material.referenceLink ?? null)
      );
    });

    // Agrupar por presupuesto
    type BudgetGroup = {
      budgetId: string;
      version: string;
      projectId: string;
      projectName: string;
      date: Date;
      components: Array<{
        componentId: string;
        itemName: string;
        itemNumber: string;
        oldDescription: string;
        newDescription: string;
        oldUnitCost: number;
        newUnitCost: number;
      }>;
    };
    const groups = new Map<string, BudgetGroup>();

    for (const c of stale) {
      const bv = c.obraItem.budgetVersion;
      if (!groups.has(bv.id)) {
        groups.set(bv.id, {
          budgetId: bv.id,
          version: bv.version,
          projectId: bv.project.id,
          projectName: bv.project.name,
          date: bv.date,
          components: [],
        });
      }
      groups.get(bv.id)!.components.push({
        componentId: c.id,
        itemName: c.obraItem.name,
        itemNumber: c.obraItem.itemNumber,
        oldDescription: c.description,
        newDescription: c.material!.name,
        oldUnitCost: c.unitCost,
        newUnitCost: c.material!.netPrice,
      });
    }

    const result = Array.from(groups.values()).sort((a, b) =>
      a.projectName.localeCompare(b.projectName)
    );

    return NextResponse.json({
      totalStaleComponents: stale.length,
      budgetsAffected: result.length,
      groups: result,
    });
  } catch (error) {
    console.error("Error en auditoría:", error);
    return NextResponse.json(
      { error: "Error en auditoría" },
      { status: 500 }
    );
  }
}
