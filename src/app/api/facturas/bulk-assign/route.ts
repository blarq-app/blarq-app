import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { upsertInvoiceRule } from "@/lib/facturas/categorizationRules";

// POST /api/facturas/bulk-assign
//
// Asigna proyecto y/o categoría a varias facturas a la vez.
// Body:
//   {
//     invoiceIds: string[],
//     projectId?: string | null,    // null para sin asignar; undefined para no tocar
//     categoryId?: string | null,   // idem
//     learnRule?: boolean           // default true: si se asigna categoría a recibidas, crea/actualiza regla por RUT
//   }
//
// Responde con stats: cuántas se actualizaron + reglas creadas/actualizadas.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      invoiceIds: string[];
      projectId?: string | null;
      categoryId?: string | null;
      learnRule?: boolean;
    };

    if (!Array.isArray(body.invoiceIds) || body.invoiceIds.length === 0) {
      return NextResponse.json(
        { error: "Se requiere invoiceIds[]" },
        { status: 400 }
      );
    }
    if (body.projectId === undefined && body.categoryId === undefined) {
      return NextResponse.json(
        { error: "Hay que asignar al menos projectId o categoryId" },
        { status: 400 }
      );
    }

    // Construir el data del update
    const data: Record<string, unknown> = {};
    if (body.projectId !== undefined) data.projectId = body.projectId;
    if (body.categoryId !== undefined) data.categoryId = body.categoryId;

    const result = await prisma.invoice.updateMany({
      where: { id: { in: body.invoiceIds } },
      data,
    });

    // Si asignó categoría y learnRule=true (default), crear/actualizar reglas
    // por cada RUT distinto entre las facturas RECIBIDAS asignadas. Cada RUT
    // genera 1 regla; si hay 12 facturas de Sodimac, se crea 1 regla.
    const learnedRules: Array<{
      ruleId: string;
      created: boolean;
      updated: boolean;
      rutIssuer: string;
      businessName: string | null;
    }> = [];

    // Aprender reglas: tanto categoría como proyecto si fueron asignados.
    // body.learnRule controla ambos (default true). Aplica a facturas con
    // rutIssuer (cualquier tipo — las emitidas también pueden tener regla
    // por RUT receptor, aunque hoy la regla usa rutIssuer del proveedor).
    if (
      body.learnRule !== false &&
      (body.categoryId || body.projectId)
    ) {
      const facturas = await prisma.invoice.findMany({
        where: {
          id: { in: body.invoiceIds },
          rutIssuer: { not: null },
        },
        select: { rutIssuer: true, businessName: true },
      });

      const seen = new Set<string>();
      for (const inv of facturas) {
        if (!inv.rutIssuer || seen.has(inv.rutIssuer)) continue;
        seen.add(inv.rutIssuer);
        try {
          const r = await upsertInvoiceRule(
            inv.rutIssuer,
            inv.businessName ?? null,
            {
              ...(body.categoryId && { categoryId: body.categoryId }),
              ...(body.projectId && { projectId: body.projectId }),
            }
          );
          learnedRules.push({
            ruleId: r.ruleId,
            created: r.created,
            updated: r.updated,
            rutIssuer: inv.rutIssuer,
            businessName: inv.businessName ?? null,
          });
        } catch (e) {
          console.error(`[bulk-assign] upsertInvoiceRule failed for ${inv.rutIssuer}:`, e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      updated: result.count,
      learnedRules,
    });
  } catch (error) {
    console.error("Error bulk-assign:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
