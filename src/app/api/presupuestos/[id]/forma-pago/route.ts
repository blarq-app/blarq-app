import { computeObraBudgetTotals } from "@/lib/projects/metrics";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Guardar/actualizar forma de pago (reemplaza todas las existentes)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const { terms } = await request.json();

    if (!Array.isArray(terms) || terms.some((term) =>
      !term || typeof term.stage !== "string" || typeof term.percentage !== "number" ||
      !Number.isFinite(term.percentage) || term.percentage < 0)) {
      return NextResponse.json({ error: "La forma de pago contiene cuotas inválidas." }, { status: 400 });
    }
    const budget = await prisma.budgetVersion.findUnique({
      where: { id: budgetVersionId }, include: { obraItems: true },
    });
    if (!budget) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    const totalObra = budget.type === "obra" ? computeObraBudgetTotals(budget).totalFinal : null;
    // El servidor calcula las cuotas de obra desde el acuerdo guardado: una
    // pantalla vieja no debe volver a guardar importes anteriores al descuento.
    const created = await prisma.$transaction(async (tx) => {
      await tx.paymentTerm.deleteMany({ where: { budgetVersionId } });
      const results = [];
      for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        results.push(await tx.paymentTerm.create({ data: {
          budgetVersionId, stage: term.stage, percentage: term.percentage,
          amount: totalObra === null ? (term.amount ?? null) : totalObra * term.percentage / 100,
          sortOrder: i,
        } }));
      }
      return results;
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error("Error updating payment terms:", error);
    return NextResponse.json(
      { error: "Error al actualizar forma de pago" },
      { status: 500 }
    );
  }
}
