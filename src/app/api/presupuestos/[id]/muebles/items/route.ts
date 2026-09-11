import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { DEFAULT_HERRAJE_UTILITY } from "@/lib/presupuesto/muebleHerrajes";

// Crear item bajo un capítulo de muebles. Auto-genera itemNumber tipo
// "{chapter}.{n+1}" según items existentes en el capítulo.
//
// Con `alternativeOfId` crea una ALTERNATIVA PARA EL CLIENTE de esa partida
// (pendiente 177): arranca como copia de la base — nombre, descripción,
// cantidad, tipo, costo, utilidad, sub-líneas de materialidad y líneas de
// herraje — para que MJ solo cambie lo que difiere (la melamina, la cubierta).
// El capítulo se toma de la base. Una alternativa no suma en ningún total.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetVersionId } = await params;
    const data = await request.json();

    if (data.alternativeOfId) {
      return crearAlternativa(budgetVersionId, String(data.alternativeOfId));
    }

    if (!data.chapterId) {
      return NextResponse.json(
        { error: "chapterId requerido" },
        { status: 400 }
      );
    }

    if (data.templateId) {
      return crearDesdePlantilla(budgetVersionId, String(data.chapterId), String(data.templateId));
    }

    const chapter = await prisma.muebleChapter.findUnique({
      where: { id: data.chapterId },
      // Solo las partidas base cuentan para la numeración y la posición: las
      // alternativas cuelgan de su base y no llevan número propio.
      include: {
        items: {
          where: { alternativeOfId: null },
          orderBy: { sortOrder: "desc" },
        },
      },
    });
    if (!chapter) {
      return NextResponse.json(
        { error: "Capítulo no encontrado" },
        { status: 404 }
      );
    }

    const nextSort =
      chapter.items.length > 0 ? chapter.items[0].sortOrder + 1 : 0;
    const nextItemIdx = chapter.items.length + 1;
    const itemNumber = `${chapter.chapterNumber}.${nextItemIdx}`;

    // kind="herrajes": partida que se arma con líneas del catálogo de herrajes.
    // Su costo lo manejan las líneas (arranca en 0) y el margen default es 20%.
    const kind = data.kind === "herrajes" ? "herrajes" : "mueble";
    const cost = data.costDistributor ?? 0;
    const utility =
      data.utilityPercentage ??
      (kind === "herrajes" ? DEFAULT_HERRAJE_UTILITY : 0);
    const net = cost * (1 + utility);
    const iva = net * 1.19;

    const item = await prisma.muebleItem.create({
      data: {
        budgetVersionId,
        chapterId: data.chapterId,
        itemNumber: data.itemNumber ?? itemNumber,
        name: data.name || (kind === "herrajes" ? "HERRAJES" : "NUEVO ITEM"),
        descriptionGeneral: data.descriptionGeneral ?? null,
        quantity: data.quantity ?? 1,
        kind,
        supplier: data.supplier ?? null,
        costDistributor: cost,
        utilityPercentage: utility,
        clientPriceNet: net,
        clientPriceIva: iva,
        sortOrder: nextSort,
      },
    });

    // Las partidas de muebles arrancan con una quote activa (para comparar
    // proveedores). Las de herrajes NO usan ese mecanismo: el proveedor es por
    // línea, así que no creamos quote.
    if (kind !== "herrajes") {
      await prisma.muebleQuote.create({
        data: {
          itemId: item.id,
          supplier: item.supplier,
          costDistributor: item.costDistributor,
          utilityPercentage: item.utilityPercentage,
          clientPriceNet: item.clientPriceNet,
          clientPriceIva: item.clientPriceIva,
          isSelected: true,
          sortOrder: 0,
        },
      });
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error creating mueble item:", error);
    return NextResponse.json(
      { error: "Error al crear item" },
      { status: 500 }
    );
  }
}

// Partida desde una PLANTILLA (MuebleItemTemplate): nace con el nombre, la
// descripción, el tipo, los componentes con su materialidad, el margen y el
// proveedor de referencia de la plantilla; cantidad 1 y costo 0 (los precios
// son de cada proyecto). Devuelve la partida CON sus relaciones.
async function crearDesdePlantilla(budgetVersionId: string, chapterId: string, templateId: string) {
  const [chapter, plantilla] = await Promise.all([
    prisma.muebleChapter.findUnique({
      where: { id: chapterId },
      include: { items: { where: { alternativeOfId: null }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } } },
    }),
    prisma.muebleItemTemplate.findUnique({
      where: { id: templateId },
      include: { details: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  if (!chapter || chapter.budgetVersionId !== budgetVersionId) {
    return NextResponse.json({ error: "Capítulo no encontrado" }, { status: 404 });
  }
  if (!plantilla) {
    return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
  }
  const nextSort = chapter.items.length > 0 ? chapter.items[0].sortOrder + 1 : 0;
  const utility = plantilla.utilityPercentage ?? (plantilla.kind === "herrajes" ? DEFAULT_HERRAJE_UTILITY : 0);
  const item = await prisma.muebleItem.create({
    data: {
      budgetVersionId,
      chapterId,
      itemNumber: `${chapter.chapterNumber}.${chapter.items.length + 1}`,
      name: plantilla.name,
      kind: plantilla.kind,
      descriptionGeneral: plantilla.descriptionGeneral,
      quantity: 1,
      supplier: plantilla.supplier,
      costDistributor: 0,
      utilityPercentage: utility,
      clientPriceNet: 0,
      clientPriceIva: 0,
      sortOrder: nextSort,
      details: { create: plantilla.details.map((d, j) => ({ name: d.name, material: d.material, sortOrder: j })) },
      ...(plantilla.kind !== "herrajes" && {
        quotes: { create: { supplier: plantilla.supplier, costDistributor: 0, utilityPercentage: utility, clientPriceNet: 0, clientPriceIva: 0, isSelected: true, sortOrder: 0 } },
      }),
    },
    include: {
      details: { orderBy: { sortOrder: "asc" } },
      quotes: { orderBy: { sortOrder: "asc" } },
      herrajes: { orderBy: { sortOrder: "asc" } },
    },
  });
  return NextResponse.json(item);
}

// Alternativa para el cliente: copia completa de la base, colgada de ella.
// Devuelve la partida CON sus relaciones (details, quotes, herrajes) porque el
// editor la mete tal cual en su estado.
async function crearAlternativa(budgetVersionId: string, baseId: string) {
  const base = await prisma.muebleItem.findUnique({
    where: { id: baseId },
    include: {
      details: { orderBy: { sortOrder: "asc" } },
      herrajes: { orderBy: { sortOrder: "asc" } },
      alternativas: { select: { sortOrder: true }, orderBy: { sortOrder: "desc" } },
    },
  });
  if (!base || base.budgetVersionId !== budgetVersionId) {
    return NextResponse.json(
      { error: "Partida base no encontrada" },
      { status: 404 }
    );
  }
  // Un solo nivel: la alternativa de una alternativa no existe. Si se quiere
  // otra opción más, se cuelga de la MISMA base.
  if (base.alternativeOfId) {
    return NextResponse.json(
      { error: "Una alternativa no puede tener alternativas: agregala sobre la partida principal" },
      { status: 400 }
    );
  }

  const nextSort =
    base.alternativas.length > 0 ? base.alternativas[0].sortOrder + 1 : 0;

  const alt = await prisma.muebleItem.create({
    data: {
      budgetVersionId,
      chapterId: base.chapterId,
      alternativeOfId: base.id,
      // Mismo número que la base: no se muestra (el editor y el PDF la rotulan
      // ALTERNATIVA), pero así queda claro de quién cuelga si se mira la base.
      itemNumber: base.itemNumber,
      name: base.name,
      descriptionGeneral: base.descriptionGeneral,
      quantity: base.quantity,
      kind: base.kind,
      supplier: base.supplier,
      costDistributor: base.costDistributor,
      utilityPercentage: base.utilityPercentage,
      clientPriceNet: base.clientPriceNet,
      clientPriceIva: base.clientPriceIva,
      sortOrder: nextSort,
      details: {
        create: base.details.map((d) => ({
          name: d.name,
          material: d.material,
          sortOrder: d.sortOrder,
        })),
      },
      herrajes: {
        create: base.herrajes.map((h) => ({
          catalogId: h.catalogId,
          sector: h.sector,
          supplier: h.supplier,
          name: h.name,
          measure: h.measure,
          finish: h.finish,
          sku: h.sku,
          quantity: h.quantity,
          costNet: h.costNet,
          sortOrder: h.sortOrder,
        })),
      },
      // Igual que una partida nueva: arranca con su cotización de proveedor
      // activa (costo interno propio; las de la base no se heredan).
      ...(base.kind !== "herrajes" && {
        quotes: {
          create: {
            supplier: base.supplier,
            costDistributor: base.costDistributor,
            utilityPercentage: base.utilityPercentage,
            clientPriceNet: base.clientPriceNet,
            clientPriceIva: base.clientPriceIva,
            isSelected: true,
            sortOrder: 0,
          },
        },
      }),
    },
    include: {
      details: { orderBy: { sortOrder: "asc" } },
      quotes: { orderBy: { sortOrder: "asc" } },
      herrajes: { orderBy: { sortOrder: "asc" } },
    },
  });
  return NextResponse.json(alt);
}
