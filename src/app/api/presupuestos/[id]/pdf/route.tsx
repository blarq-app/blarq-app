import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderObraHTML, buildObraFooter } from "@/lib/pdf/ObraPDF.html";
import { renderMueblesHTML, buildMueblesFooter } from "@/lib/pdf/MueblesPDF.html";
import {
  renderArtefactosHTML,
  buildArtefactosFooter,
} from "@/lib/pdf/ArtefactosPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";

// Forzar Node runtime (no edge) — Puppeteer/Chromium necesita Node.
export const runtime = "nodejs";
// La generación de PDF con Chromium headless puede tomar 10-30s. Default
// Vercel free tier es 10s, Pro 60s — subimos al máximo permitido.
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const budget = await prisma.budgetVersion.findUnique({
      where: { id },
      include: {
        project: true,
        obraItems: { orderBy: { sortOrder: "asc" } },
        muebleChapters: {
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
              include: { details: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
        artefactoItems: { orderBy: { sortOrder: "asc" } },
        paymentTerms: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!budget) {
      return NextResponse.json(
        { error: "Presupuesto no encontrado" },
        { status: 404 }
      );
    }

    let html: string;
    let footer: string;
    let filename: string;
    const baseName = budget.project.name.replace(/\s+/g, "_");

    if (budget.type === "obra") {
      html = renderObraHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          ggPercentage: budget.ggPercentage,
          utilityPercentage: budget.utilityPercentage,
        },
        items: budget.obraItems,
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      footer = buildObraFooter(budget.version, budget.date);
      filename = `BLARQ_Obra_${baseName}_${budget.version}.pdf`;
    } else if (budget.type === "muebles") {
      html = renderMueblesHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          observations: budget.observations,
        },
        chapters: budget.muebleChapters.map((ch) => ({
          chapterNumber: ch.chapterNumber,
          name: ch.name,
          items: ch.items.map((i) => ({
            itemNumber: i.itemNumber,
            name: i.name,
            descriptionGeneral: i.descriptionGeneral,
            quantity: i.quantity,
            clientPriceIva: i.clientPriceIva,
            details: i.details.map((d) => ({
              name: d.name,
              material: d.material,
            })),
          })),
        })),
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      footer = buildMueblesFooter(budget.version, budget.date);
      filename = `BLARQ_Muebles_${baseName}_${budget.version}.pdf`;
    } else {
      html = renderArtefactosHTML({
        project: budget.project,
        budget: {
          version: budget.version,
          date: budget.date,
          observations: budget.observations,
        },
        items: budget.artefactoItems,
        paymentTerms: budget.paymentTerms.map((t) => ({
          stage: t.stage,
          percentage: t.percentage,
        })),
      });
      footer = buildArtefactosFooter(budget.version, budget.date);
      filename = `BLARQ_Artefactos_${baseName}_${budget.version}.pdf`;
    }

    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: footer,
      margin: { top: "14mm", bottom: "16mm", left: "15mm", right: "15mm" },
    });

    const body = new Uint8Array(pdfBuffer.byteLength);
    body.set(pdfBuffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    );
  }
}
