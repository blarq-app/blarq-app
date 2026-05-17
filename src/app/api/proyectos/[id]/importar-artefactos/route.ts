/**
 * Importar artefactos desde Excel (formato MK / TEKA / LedStudio).
 *
 * Recibe multipart/form-data con un archivo Excel y crea un BudgetVersion
 * V_next type=artefactos status=borrador para el proyecto, con un
 * ArtefactoItem por cada fila parseada.
 *
 * El parser soporta hojas:
 *   - "ARTEFACTOS SANITARIOS" → subcategory=sanitario, agrupa por header
 *     de habitación (BAÑO PRINCIPAL, BAÑO SECUNDARIO, etc).
 *   - "ARTEFACTOS … COCINA / TEKA" → subcategory=cocina.
 *   - "ARTEFACTOS … ILUMINACION / LED" → subcategory=iluminacion.
 * Las hojas "MAESTRA" y las que terminan en " HG" (versión vieja) se
 * ignoran.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseArtefactos } from "@/lib/import/parseArtefactos";
import { ensureArtefactoCatalog } from "@/lib/catalog/ensureArtefactoCatalog";

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
    const parsed = parseArtefactos(buffer);

    if (parsed.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se extrajo ningún ítem del Excel. Verificá que tenga hojas tipo 'ARTEFACTOS SANITARIOS', 'ARTEFACTOS COCINA' o 'ARTEFACTOS ILUMINACION'.",
          warnings: parsed.warnings,
        },
        { status: 422 }
      );
    }

    // Versión automática V_next dentro de artefactos
    const existing = await prisma.budgetVersion.findMany({
      where: { projectId, type: "artefactos" },
      orderBy: { createdAt: "desc" },
      select: { version: true },
    });
    const maxV = existing.reduce((max, b) => {
      const m = b.version.match(/^V(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const version = `V${maxV + 1}`;

    const result = await prisma.$transaction(async (tx) => {
      const bv = await tx.budgetVersion.create({
        data: {
          projectId,
          version,
          type: "artefactos",
          status: "borrador",
        },
      });

      let sortOrder = 0;
      for (const it of parsed.items) {
        // Cada artefacto importado entra también al catálogo BLARQ (se
        // reutiliza la entrada si ya existe una con el mismo nombre).
        const catalogId = await ensureArtefactoCatalog(tx, {
          name: it.name,
          detail: it.detail,
          brand: it.brand,
          subcategory: it.subcategory,
          referenceLink: it.referenceLink,
          listPrice: it.listPrice,
          discountPercent: it.discountPercent,
        });
        await tx.artefactoItem.create({
          data: {
            budgetVersionId: bv.id,
            room: it.room,
            subcategory: it.subcategory,
            name: it.name,
            detail: it.detail,
            brand: it.brand,
            quantity: it.quantity,
            listPrice: it.listPrice,
            discountPercent: it.discountPercent,
            clientPrice: it.clientPrice,
            realCostBlarq: it.realCostBlarq,
            referenceLink: it.referenceLink,
            catalogId,
            sortOrder: sortOrder++,
          },
        });
      }

      // Forma de pago default para artefactos (anticipo / contra entrega)
      await tx.paymentTerm.createMany({
        data: [
          { budgetVersionId: bv.id, stage: "Anticipo", percentage: 50, sortOrder: 0 },
          { budgetVersionId: bv.id, stage: "Contra entrega", percentage: 50, sortOrder: 1 },
        ],
      });

      return bv;
    });

    // Resumen por subcategory / room para mostrar en el modal de éxito.
    const byGroup = new Map<string, number>();
    for (const it of parsed.items) {
      const k = `${it.subcategory} / ${it.room}`;
      byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
    }
    const summaryGroups = Array.from(byGroup, ([group, count]) => ({
      group,
      count,
    }));

    return NextResponse.json({
      budgetVersionId: result.id,
      version: result.version,
      summary: {
        totalItems: parsed.items.length,
        groups: summaryGroups,
      },
      warnings: parsed.warnings,
    });
  } catch (error) {
    console.error("Error importando artefactos:", error);
    const message =
      error instanceof Error ? error.message : "Error al importar artefactos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
