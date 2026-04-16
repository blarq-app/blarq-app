import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Guardar/actualizar forma de pago (reemplaza todas las existentes)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: budgetVersionId } = await params;
    const { terms } = await request.json();

    // Eliminar las existentes
    await prisma.paymentTerm.deleteMany({
      where: { budgetVersionId },
    });

    // Crear las nuevas
    const created = [];
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const result = await prisma.paymentTerm.create({
        data: {
          budgetVersionId,
          stage: term.stage,
          percentage: term.percentage,
          amount: term.amount || null,
          sortOrder: i,
        },
      });
      created.push(result);
    }

    return NextResponse.json(created);
  } catch (error) {
    console.error("Error updating payment terms:", error);
    return NextResponse.json(
      { error: "Error al actualizar forma de pago" },
      { status: 500 }
    );
  }
}
