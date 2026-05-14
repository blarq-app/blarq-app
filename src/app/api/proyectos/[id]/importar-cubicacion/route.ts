/**
 * Importar cubicación desde Excel de JP.
 *
 * Recibe multipart/form-data con un archivo Excel (hoja CUBICACION) y crea
 * un BudgetVersion V_next obra status=borrador para el proyecto, con un
 * ObraItem por cada ítem del Excel:
 *   - Si el nombre matchea un PartidaCatalog (case-insensitive trim):
 *     copia descripciones + unit + unitPrice + cost* + componentes del
 *     catálogo + quantity del Excel + sub-chapter del Excel.
 *   - Si NO matchea: crea el ObraItem igual con unitPrice=0 y la
 *     descripción del Excel — queda para que MJ termine de armar.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseCubicacion } from "@/lib/import/parseCubicacion";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Archivo Excel requerido (campo 'file' del form)" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseCubicacion(buffer);

    if (parsed.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se extrajo ningún ítem del Excel. Verificá que tenga una hoja 'CUBICACION' con el formato esperado.",
          warnings: parsed.warnings,
        },
        { status: 422 }
      );
    }

    // Versión automática V_next
    const existing = await prisma.budgetVersion.findMany({
      where: { projectId, type: "obra" },
      orderBy: { createdAt: "desc" },
      select: { version: true },
    });
    const maxV = existing.reduce((max, b) => {
      const m = b.version.match(/^V(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const version = `V${maxV + 1}`;

    // Cargar TODAS las partidas del catálogo en memoria — match por nombre.
    // Lo hacemos en JS porque queremos un match case-insensitive trim que
    // Prisma no expresa fácilmente.
    const catalog = await prisma.partidaCatalog.findMany({
      include: {
        components: true,
      },
    });
    const catalogByName = new Map<string, (typeof catalog)[0]>();
    for (const c of catalog) {
      catalogByName.set(c.name.trim().toUpperCase(), c);
    }

    type Matched = { item: typeof parsed.items[0]; cat: (typeof catalog)[0] };
    type NotMatched = { item: typeof parsed.items[0] };
    const matched: Matched[] = [];
    const notMatched: NotMatched[] = [];

    for (const it of parsed.items) {
      const key = it.name.trim().toUpperCase();
      const cat = catalogByName.get(key);
      if (cat) {
        matched.push({ item: it, cat });
      } else {
        notMatched.push({ item: it });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const bv = await tx.budgetVersion.create({
        data: {
          projectId,
          version,
          type: "obra",
          status: "borrador",
          ggPercentage: 20,
          utilityPercentage: 10,
        },
      });

      let sortOrder = 0;
      for (const m of matched) {
        const obraItem = await tx.obraItem.create({
          data: {
            budgetVersionId: bv.id,
            chapter: m.item.chapter,
            subChapter: m.item.subChapter,
            itemNumber: m.item.itemNumber,
            name: m.cat.name,
            descriptionCliente: m.cat.descriptionCliente,
            descriptionMaestro: m.cat.descriptionMaestro,
            unit: m.cat.unit,
            quantity: m.item.quantity,
            unitPrice: m.cat.unitPrice,
            total: m.item.quantity * m.cat.unitPrice,
            costMaterial: m.cat.costMaterial,
            costLabor: m.cat.costLabor,
            costSubcontract: m.cat.costSubcontract,
            costMargin: m.cat.costMargin,
            costTools: m.cat.costTools,
            costLoss: m.cat.costLoss,
            sortOrder: sortOrder++,
            catalogPartidaId: m.cat.id,
            isCustomized: false,
          },
        });
        // Snapshot de componentes para edición a nivel proyecto
        for (const c of m.cat.components) {
          await tx.obraItemComponent.create({
            data: {
              obraItemId: obraItem.id,
              type: c.type,
              description: c.description,
              unit: c.unit,
              quantity: c.quantity,
              unitCost: c.unitCost,
              totalCost: c.totalCost,
              referenceLink: c.referenceLink,
              materialId: c.materialId,
              sortOrder: c.sortOrder,
              appliedToComponentId: c.appliedToComponentId,
              appliedToType: c.appliedToType,
              isCustomized: false,
            },
          });
        }
      }

      // Ítems no matched — los creamos igual para que MJ los vea y los
      // termine de armar después en el editor. Quedan con unitPrice=0.
      for (const nm of notMatched) {
        await tx.obraItem.create({
          data: {
            budgetVersionId: bv.id,
            chapter: nm.item.chapter,
            subChapter: nm.item.subChapter,
            itemNumber: nm.item.itemNumber,
            name: nm.item.name,
            descriptionCliente: nm.item.description,
            unit: nm.item.unit,
            quantity: nm.item.quantity,
            unitPrice: 0,
            total: 0,
            sortOrder: sortOrder++,
            catalogPartidaId: null,
            isCustomized: true, // creado a mano, no del catálogo
          },
        });
      }

      // Forma de pago default (igual que el resto del flujo de obra)
      await tx.paymentTerm.createMany({
        data: [
          { budgetVersionId: bv.id, stage: "Anticipo", percentage: 40, sortOrder: 0 },
          { budgetVersionId: bv.id, stage: "Avance 1", percentage: 25, sortOrder: 1 },
          { budgetVersionId: bv.id, stage: "Avance 2", percentage: 25, sortOrder: 2 },
          { budgetVersionId: bv.id, stage: "Saldo final", percentage: 10, sortOrder: 3 },
        ],
      });

      return bv;
    });

    return NextResponse.json({
      budgetVersionId: result.id,
      version: result.version,
      summary: {
        totalItems: parsed.items.length,
        matched: matched.length,
        notMatched: notMatched.length,
        notMatchedList: notMatched.map((nm) => ({
          chapter: nm.item.chapterRaw,
          subChapter: nm.item.subChapter,
          name: nm.item.name,
          quantity: nm.item.quantity,
          unit: nm.item.unit,
        })),
      },
      warnings: parsed.warnings,
    });
  } catch (error) {
    console.error("Error importando cubicación:", error);
    const message =
      error instanceof Error ? error.message : "Error al importar cubicación";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
