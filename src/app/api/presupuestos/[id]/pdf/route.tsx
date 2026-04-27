import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import MueblesPDF from "@/lib/pdf/MueblesPDF";
import ArtefactosPDF from "@/lib/pdf/ArtefactosPDF";
import { renderObraHTML, buildObraFooter } from "@/lib/pdf/ObraPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";

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
        muebleItems: { orderBy: { sortOrder: "asc" } },
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

    let pdfBuffer: Uint8Array;
    let filename: string;

    if (budget.type === "obra") {
      // ── Puppeteer + HTML/CSS path (matches Excel reference) ──
      const html = renderObraHTML({
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

      pdfBuffer = await renderPDF(html, {
        format: "A4",
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: buildObraFooter(budget.version, budget.date),
        margin: { top: "14mm", bottom: "16mm", left: "15mm", right: "15mm" },
      });

      filename = `BLARQ_Obra_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    } else if (budget.type === "muebles") {
      // ── Legacy @react-pdf flow (not yet migrated) ──
      const pdfDocument: React.ReactElement = (
        <MueblesPDF
          project={budget.project}
          budget={{
            version: budget.version,
            date: budget.date,
            observations: budget.observations,
          }}
          items={budget.muebleItems}
          paymentTerms={budget.paymentTerms}
        />
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfBuffer = new Uint8Array(await renderToBuffer(pdfDocument as any));
      filename = `BLARQ_Muebles_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    } else {
      const pdfDocument: React.ReactElement = (
        <ArtefactosPDF
          project={budget.project}
          budget={{
            version: budget.version,
            date: budget.date,
            observations: budget.observations,
          }}
          items={budget.artefactoItems}
          paymentTerms={budget.paymentTerms}
        />
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfBuffer = new Uint8Array(await renderToBuffer(pdfDocument as any));
      filename = `BLARQ_Artefactos_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    }

    // Copy into a fresh ArrayBuffer-backed Uint8Array for NextResponse's BodyInit
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
