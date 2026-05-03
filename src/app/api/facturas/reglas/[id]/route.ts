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
// Permite cambiar la categoría de una regla existente.
// Aplica retroactivamente a facturas SIN categoría asignada del mismo RUT.
// Las facturas que ya tenían otra categoría asignada NO se tocan.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{ categoryId: string }>;
    const updated = await prisma.invoiceCategorizationRule.update({
      where: { id },
      data: {
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
      },
    });

    // Si cambió la categoría, aplicar retroactivamente a facturas sin categoría.
    let appliedRetroactively = 0;
    if (body.categoryId !== undefined) {
      const retro = await prisma.invoice.updateMany({
        where: {
          type: "recibida",
          rutIssuer: updated.rutIssuer,
          categoryId: null,
        },
        data: { categoryId: body.categoryId },
      });
      appliedRetroactively = retro.count;
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
