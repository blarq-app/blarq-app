import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: partidaId } = await params;
    const data = await request.json();

    // Contar componentes existentes para sortOrder
    const count = await prisma.partidaComponent.count({ where: { partidaId } });

    const component = await prisma.partidaComponent.create({
      data: {
        partidaId,
        type: data.type || "material",
        description: data.description || "",
        unit: data.unit || "UN",
        quantity: data.quantity ?? 1,
        unitCost: data.unitCost ?? 0,
        // El front calcula totalCost (con la lógica de %, pérdida sobre
        // material, leyes sobre MO, etc.) y lo manda explícito.
        totalCost: data.totalCost ?? (data.quantity ?? 1) * (data.unitCost ?? 0),
        sortOrder: data.sortOrder ?? count,
        materialId: data.materialId ?? null,
        referenceLink: data.referenceLink ?? null,
        appliedToComponentId: data.appliedToComponentId ?? null,
        appliedToType: data.appliedToType ?? null,
      },
      include: { material: true },
    });

    return NextResponse.json(component);
  } catch (error) {
    console.error("Error creating component:", error);
    return NextResponse.json({ error: "Error al crear componente" }, { status: 500 });
  }
}
