import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import ObraPDF from "@/lib/pdf/ObraPDF";
import MueblesPDF from "@/lib/pdf/MueblesPDF";
import ArtefactosPDF from "@/lib/pdf/ArtefactosPDF";

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

    let pdfDocument: React.ReactElement;
    let filename: string;

    if (budget.type === "obra") {
      pdfDocument = (
        <ObraPDF
          project={budget.project}
          budget={{
            version: budget.version,
            date: budget.date,
            ggPercentage: budget.ggPercentage,
            utilityPercentage: budget.utilityPercentage,
            observations: budget.observations,
          }}
          items={budget.obraItems}
          paymentTerms={budget.paymentTerms}
        />
      );
      filename = `BLARQ_Obra_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    } else if (budget.type === "muebles") {
      pdfDocument = (
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
      filename = `BLARQ_Muebles_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    } else {
      pdfDocument = (
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
      filename = `BLARQ_Artefactos_${budget.project.name.replace(/\s+/g, "_")}_${budget.version}.pdf`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(pdfDocument as any);

    return new NextResponse(new Uint8Array(pdfBuffer), {
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
