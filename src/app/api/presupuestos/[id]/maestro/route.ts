import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  renderObraMaestroHTML,
  buildObraMaestroFooter,
} from "@/lib/pdf/ObraMaestroPDF.html";
import { buildObraMaestroXLSX } from "@/lib/xlsx/ObraMaestroXLSX";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { esSinManoDeObra } from "@/lib/ep/hideNoLabor";
import { requireSession } from "@/lib/apiAuth";

// Puppeteer/Chromium necesita Node runtime; XLSX tambien.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Export "Cotizacion Maestro" desde un presupuesto de obra. Mismos items
 * que la cotizacion al cliente, sin precios — para que el maestro cotice.
 *
 * GET /api/presupuestos/:id/maestro?format=pdf|xlsx
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const format = request.nextUrl.searchParams.get("format") ?? "pdf";
    // Si viene maestroId, el alcance sale filtrado a las partidas de ese
    // maestro (un alcance limpio por contratista). Sin maestroId → todas.
    const maestroId = request.nextUrl.searchParams.get("maestroId");

    if (format !== "pdf" && format !== "xlsx") {
      return NextResponse.json(
        { error: "format debe ser 'pdf' o 'xlsx'" },
        { status: 400 }
      );
    }

    const budget = await prisma.budgetVersion.findUnique({
      where: { id },
      include: {
        project: { include: { maestro: true } },
        obraChapters: { orderBy: { sortOrder: "asc" } },
        obraItems: {
          where: maestroId ? { maestroId } : undefined,
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!budget) {
      return NextResponse.json(
        { error: "Presupuesto no encontrado" },
        { status: 404 }
      );
    }

    if (budget.type !== "obra") {
      return NextResponse.json(
        { error: "Solo disponible para presupuestos de obra (mano de obra)" },
        { status: 400 }
      );
    }

    // Cuando el alcance es de un maestro puntual, el encabezado lleva SU nombre
    // (no el maestro "principal" legacy del proyecto).
    const maestroFiltrado = maestroId
      ? await prisma.maestro.findUnique({
          where: { id: maestroId },
          select: { name: true },
        })
      : null;

    // Esconder las partidas que no llevan mano de obra del maestro
    // (material/subcontrato de un tercero, ej. "espejo a medida"): no son su
    // trabajo, no tiene que cotizarlas. Mismo criterio que el EP.
    const visibleObraItems = budget.obraItems.filter(
      (it) => !esSinManoDeObra(it.costLabor ?? 0, it)
    );

    if (maestroId && visibleObraItems.length === 0) {
      return NextResponse.json(
        { error: "Este maestro no tiene partidas asignadas en esta versión" },
        { status: 400 }
      );
    }

    const maestroSuffix = maestroFiltrado
      ? "_" + maestroFiltrado.name.replace(/\s+/g, "_")
      : "";
    const baseName =
      budget.project.name.replace(/\s+/g, "_") + maestroSuffix;
    const projectInput = {
      name: budget.project.name,
      clientName: budget.project.clientName,
      address: budget.project.address,
    };
    const budgetInput = { version: budget.version, date: budget.date };
    const maestroInput = maestroFiltrado
      ? { name: maestroFiltrado.name }
      : budget.project.maestro
        ? { name: budget.project.maestro.name }
        : null;
    const chaptersInput = budget.obraChapters;
    const itemsInput = visibleObraItems.map((it) => ({
      chapterId: it.chapterId,
      subChapter: it.subChapter,
      sortOrder: it.sortOrder,
      name: it.name,
      descriptionMaestro: it.descriptionMaestro,
      descriptionCliente: it.descriptionCliente,
      unit: it.unit,
      quantity: it.quantity,
    }));

    if (format === "xlsx") {
      const buffer = await buildObraMaestroXLSX({
        project: projectInput,
        budget: budgetInput,
        maestro: maestroInput,
        chapters: chaptersInput,
        items: itemsInput,
      });
      const filename = `BLARQ_Cotizacion_Maestro_${baseName}_${budget.version}.xlsx`;
      const body = new Uint8Array(buffer.byteLength);
      body.set(buffer);
      return new NextResponse(body, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // PDF
    const html = renderObraMaestroHTML({
      project: projectInput,
      budget: budgetInput,
      maestro: maestroInput,
      chapters: chaptersInput,
      items: itemsInput,
    });
    const footer = buildObraMaestroFooter(budget.version, budget.date);
    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: footer,
      margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    const filename = `BLARQ_Cotizacion_Maestro_${baseName}_${budget.version}.pdf`;
    const body = new Uint8Array(pdfBuffer.byteLength);
    body.set(pdfBuffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generando cotizacion maestro:", error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { error: "Error al generar cotizacion maestro", detail: message, stack },
      { status: 500 }
    );
  }
}
