import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { upsertInvoiceRule } from "@/lib/facturas/categorizationRules";
import { requireSession } from "@/lib/apiAuth";

// POST /api/facturas/bulk-assign
//
// Asigna proyecto y/o categoría a varias facturas a la vez.
// Body:
//   {
//     invoiceIds: string[],
//     projectId?: string | null,         // null para sin asignar; undefined para no tocar
//     categoryId?: string | null,        // idem
//     learnCategoryRule?: boolean,       // default true: guarda categoría en la regla del RUT
//     learnProjectRule?: boolean,        // default FALSE: solo guardar proyecto en regla
//                                        // cuando el proveedor SIEMPRE va al mismo proyecto
//                                        // (Autopistas/Bencina/Patente = BLARQ). Para
//                                        // proveedores transversales (Easy/Sodimac/MK)
//                                        // dejar apagado.
//   }
//
// Responde con stats: cuántas se actualizaron + reglas creadas/actualizadas.
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const body = (await request.json()) as {
      invoiceIds: string[];
      projectId?: string | null;
      categoryId?: string | null;
      learnCategoryRule?: boolean;
      learnProjectRule?: boolean;
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

    const learnedRules: Array<{
      ruleId: string | null;
      created: boolean;
      updated: boolean;
      rutIssuer: string | null;
      businessName: string | null;
    }> = [];

    // Aprender reglas — dos toggles independientes:
    //   - categoría: default ON. Easy = Materiales casi siempre, conviene
    //     que se contagie a futuras facturas del mismo proveedor.
    //   - proyecto: default OFF. La mayoría de los proveedores son
    //     transversales (Easy compra para muchas obras). Solo prendelo
    //     cuando el proveedor identifica unívocamente al proyecto
    //     (ej. Autopistas → BLARQ siempre).
    const learnCat =
      body.learnCategoryRule !== false &&
      typeof body.categoryId === "string" &&
      body.categoryId.length > 0;
    const learnProj =
      body.learnProjectRule === true &&
      typeof body.projectId === "string" &&
      body.projectId.length > 0;

    if (learnCat || learnProj) {
      // Incluimos también las facturas SIN RUT (proveedores internacionales):
      // su regla se guarda por nombre exacto. Antes se filtraban con
      // rutIssuer: { not: null } y nunca aprendían regla.
      const facturas = await prisma.invoice.findMany({
        where: { id: { in: body.invoiceIds } },
        select: { rutIssuer: true, businessName: true },
      });

      // Dedup por clave de proveedor: el RUT si existe, si no el nombre.
      const seen = new Set<string>();
      for (const inv of facturas) {
        const key = inv.rutIssuer ?? (inv.businessName ? `name:${inv.businessName}` : null);
        if (!key || seen.has(key)) continue; // sin RUT ni nombre → no se puede identificar
        seen.add(key);
        try {
          const r = await upsertInvoiceRule(
            inv.rutIssuer ?? null,
            inv.businessName ?? null,
            {
              ...(learnCat && { categoryId: body.categoryId as string }),
              ...(learnProj && { projectId: body.projectId as string }),
            }
          );
          learnedRules.push({
            ruleId: r.ruleId,
            created: r.created,
            updated: r.updated,
            rutIssuer: inv.rutIssuer ?? null,
            businessName: inv.businessName ?? null,
          });
        } catch (e) {
          console.error(`[bulk-assign] upsertInvoiceRule failed for ${key}:`, e);
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
