import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// DELETE /api/banco/reglas/[id]
// Elimina una regla de auto-categorización. Los movimientos ya
// categorizados con esa regla NO se modifican — quedan como están.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    await prisma.bankCategorizationRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error delete rule:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}

// PATCH /api/banco/reglas/[id]
// Permite editar el patrón / categoría de una regla existente.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      descriptionPattern: string;
      category: string;
    }>;
    const updated = await prisma.bankCategorizationRule.update({
      where: { id },
      data: {
        ...(body.descriptionPattern !== undefined && {
          descriptionPattern: body.descriptionPattern,
        }),
        ...(body.category !== undefined && { category: body.category }),
      },
    });
    return NextResponse.json({ ok: true, rule: updated });
  } catch (error) {
    console.error("Error patch rule:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
