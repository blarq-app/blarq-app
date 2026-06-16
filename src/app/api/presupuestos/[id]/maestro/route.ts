import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  renderObraMaestroHTML,
  buildObraMaestroFooter,
} from "@/lib/pdf/ObraMaestroPDF.html";
import { buildObraMaestroXLSX } from "@/lib/xlsx/ObraMaestroXLSX";
import { renderPDF } from "@/lib/pdf/renderPDF";
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
        obraItems: { orderBy: { sortOrder: "asc" } },
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

    const baseName = budget.project.name.replace(/\s+/g, "_");
    const projectInput = {
      name: budget.project.name,
      clientName: budget.project.clientName,
      address: budget.project.address,
    };
    const budgetInput = { version: budget.version, date: budget.date };
    const maestroInput = budget.project.maestro
      ? { name: budget.project.maestro.name }
      : null;
    const itemsInput = budget.obraItems.map((it) => ({
      chapter: it.chapter,
      subChapter: it.subChapter,
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
