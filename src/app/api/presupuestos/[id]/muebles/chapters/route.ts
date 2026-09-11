import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { DEFAULT_HERRAJE_UTILITY } from "@/lib/presupuesto/muebleHerrajes";

// Crear capítulo de muebles bajo un presupuesto.
//
// Con `templateId` (plantilla de capítulo, ver MuebleChapterTemplate) el
// capítulo nace con las partidas de la plantilla — nombre, descripción, tipo,
// componentes con su materialidad, margen y proveedor de referencia —, sin
// precios ni cantidades (cantidad 1, costo 0: eso es de cada proyecto). Las
// partidas de muebles arrancan con su cotización de proveedor activa igual
// que una creada a mano; las de herrajes nacen vacías para llenar del catálogo.
// Devuelve el capítulo CON sus partidas y relaciones, para que el editor lo
// meta tal cual en su estado.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    const existing = await prisma.muebleChapter.findMany({
      where: { budgetVersionId },
      orderBy: { sortOrder: "desc" },
      take: 1,
    });
    const nextSort = existing.length > 0 ? existing[0].sortOrder + 1 : 0;
    const nextNumber = existing.length > 0 ? existing[0].chapterNumber + 1 : 1;
    const chapterNumber: number = data.chapterNumber ?? nextNumber;

    if (data.templateId) {
      const plantilla = await prisma.muebleChapterTemplate.findUnique({
        where: { id: String(data.templateId) },
        include: { items: { orderBy: { sortOrder: "asc" }, include: { details: { orderBy: { sortOrder: "asc" } } } } },
      });
      if (!plantilla) {
        return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
      }
      const chapter = await prisma.muebleChapter.create({
        data: {
          budgetVersionId,
          chapterNumber,
          name: (data.name || plantilla.name).toUpperCase(),
          sortOrder: nextSort,
          items: {
            create: plantilla.items.map((t, i) => {
              const utility = t.utilityPercentage ?? (t.kind === "herrajes" ? DEFAULT_HERRAJE_UTILITY : 0);
              return {
                budgetVersionId,
                itemNumber: `${chapterNumber}.${i + 1}`,
                name: t.name,
                kind: t.kind,
                descriptionGeneral: t.descriptionGeneral,
                quantity: 1,
                supplier: t.supplier,
                costDistributor: 0,
                utilityPercentage: utility,
                clientPriceNet: 0,
                clientPriceIva: 0,
                sortOrder: i,
                details: { create: t.details.map((d, j) => ({ name: d.name, material: d.material, sortOrder: j })) },
                ...(t.kind !== "herrajes" && {
                  quotes: { create: { supplier: t.supplier, costDistributor: 0, utilityPercentage: utility, clientPriceNet: 0, clientPriceIva: 0, isSelected: true, sortOrder: 0 } },
                }),
              };
            }),
          },
        },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              details: { orderBy: { sortOrder: "asc" } },
              quotes: { orderBy: { sortOrder: "asc" } },
              herrajes: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      });
      return NextResponse.json(chapter);
    }

    const chapter = await prisma.muebleChapter.create({
      data: {
        budgetVersionId,
        chapterNumber,
        name: data.name || "NUEVO CAPITULO",
        sortOrder: nextSort,
      },
    });
    return NextResponse.json(chapter);
  } catch (error) {
    console.error("Error creating muebles chapter:", error);
    return NextResponse.json(
      { error: "Error al crear capítulo" },
      { status: 500 }
    );
  }
}
