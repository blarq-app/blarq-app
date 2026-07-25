import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { providerInvoiceWhere } from "@/lib/facturas/categorizationRules";

// DELETE /api/facturas/reglas/[id]
// Elimina la regla. Las facturas previamente categorizadas con esta
// regla NO se modifican — solo afecta a futuras.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    await prisma.invoiceCategorizationRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error delete invoice rule:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}

// PATCH /api/facturas/reglas/[id]
// Permite cambiar categoría y/o proyecto de una regla existente.
// Body acepta { categoryId?: string|null, projectId?: string|null }.
// Aplica retroactivamente a facturas SIN ese campo asignado del mismo RUT.
// Las facturas que ya tenían valor manual NO se tocan.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      categoryId: string | null;
      projectId: string | null;
    }>;
    const updated = await prisma.invoiceCategorizationRule.update({
      where: { id },
      data: {
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.projectId !== undefined && { projectId: body.projectId }),
      },
    });

    // WHERE del proveedor: por RUT, o por nombre exacto si la regla es de un
    // internacional sin RUT. Sin el helper, un `rutIssuer: null` acá haría
    // updateMany sobre TODAS las facturas sin RUT (bug).
    const provWhere = providerInvoiceWhere(updated.rutIssuer, updated.providerName);
    let appliedRetroactively = 0;
    if (body.categoryId && provWhere) {
      const retro = await prisma.invoice.updateMany({
        where: { ...provWhere, categoryId: null },
        data: { categoryId: body.categoryId },
      });
      appliedRetroactively += retro.count;
    }
    if (body.projectId && provWhere) {
      const retro = await prisma.invoice.updateMany({
        where: { ...provWhere, projectId: null },
        data: { projectId: body.projectId },
      });
      appliedRetroactively += retro.count;
    }

    return NextResponse.json({ ok: true, rule: updated, appliedRetroactively });
  } catch (error) {
    console.error("Error patch invoice rule:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
