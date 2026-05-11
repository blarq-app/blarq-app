import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// DELETE /api/facturas/reglas/[id]
// Elimina la regla. Las facturas previamente categorizadas con esta
// regla NO se modifican — solo afecta a futuras.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    let appliedRetroactively = 0;
    if (body.categoryId) {
      const retro = await prisma.invoice.updateMany({
        where: { rutIssuer: updated.rutIssuer, categoryId: null },
        data: { categoryId: body.categoryId },
      });
      appliedRetroactively += retro.count;
    }
    if (body.projectId) {
      const retro = await prisma.invoice.updateMany({
        where: { rutIssuer: updated.rutIssuer, projectId: null },
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
