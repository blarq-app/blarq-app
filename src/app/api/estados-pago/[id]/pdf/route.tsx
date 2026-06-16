import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderEPHtml, buildEPFooter, type EPItemInput } from "@/lib/pdf/EstadoPagoPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { computeEPItem, type EPItemSnapshot } from "@/lib/ep/calculations";
import { requireSession } from "@/lib/apiAuth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;

    const ep = await prisma.estadoPago.findUnique({
      where: { id },
      include: {
        project: { include: { maestro: true } },
        items: { orderBy: { sortOrder: "asc" } },
        budgetVersion: { select: { version: true } },
      },
    });

    if (!ep) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    // EPs CERRADOS anteriores → para acumulado y para histórico
    const prevClosedEps = await prisma.estadoPago.findMany({
      where: {
        projectId: ep.projectId,
        status: "cerrado",
        number: { lt: ep.number },
      },
      orderBy: { number: "asc" },
      include: { items: true },
    });

    // Acumulado previo por lineageId (estable a través de versiones del presupuesto)
    const prevExecMap = new Map<string, number>();
    const prevAmountMap = new Map<string, number>();
    for (const p of prevClosedEps) {
      for (const it of p.items) {
        prevExecMap.set(
          it.lineageId,
          Math.max(prevExecMap.get(it.lineageId) ?? 0, it.quantityExecuted)
        );
        prevAmountMap.set(
          it.lineageId,
          (prevAmountMap.get(it.lineageId) ?? 0) + (it.amountPaid ?? 0)
        );
      }
    }

    // Compute amountThisEp por item usando la lógica pura
    const itemsForPdf: EPItemInput[] = ep.items.map((i) => {
      const snap: EPItemSnapshot = {
        quantity: i.quantity,
        laborUnitPrice: i.laborUnitPrice,
        quantityExecuted: i.quantityExecuted,
        prevExecutedQuantity: prevExecMap.get(i.lineageId) ?? 0,
        prevAmountPaid: prevAmountMap.get(i.lineageId) ?? 0,
        outOfScope: i.outOfScope,
      };
      const c = computeEPItem(snap);
      return {
        chapter: i.chapter,
        subChapter: i.subChapter,
        itemNumber: i.itemNumber,
        name: i.name,
        descriptionMaestro: i.descriptionMaestro,
        unit: i.unit,
        quantity: i.quantity,
        laborUnitPrice: i.laborUnitPrice,
        pctAccumulated: c.pctAccumulatedCurrent,
        amountThisEp: c.amountThisEp,
        totalAccumulated: c.totalAccumulated,
        outOfScope: i.outOfScope,
      };
    });

    const totalLaborBudget = ep.items.reduce(
      (s, i) => s + i.quantity * i.laborUnitPrice,
      0
    );
    const totalAmountThisEp = itemsForPdf.reduce(
      (s, i) => s + i.amountThisEp,
      0
    );

    const previousEps = prevClosedEps.map((p) => ({
      number: p.number,
      date: p.closedAt ?? p.date,
      totalPaid: p.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0),
    }));

    const html = renderEPHtml({
      project: ep.project,
      ep: {
        number: ep.number,
        date: ep.date,
        notes: ep.notes,
        budgetVersion: ep.budgetVersion?.version ?? null,
      },
      items: itemsForPdf,
      previousEps,
      totalLaborBudget,
      totalAmountThisEp,
    });

    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      // landscape para acomodar las 9 columnas (item, partida, desc, un, cant, pu, total, avance, $a pagar)
      // A4 landscape lo handlea bien Puppeteer ya que el CSS usa @page size: A4 landscape
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: buildEPFooter(ep.number, ep.date),
      margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });

    const filename = `BLARQ_EP${ep.number}_${ep.project.name.replace(
      /\s+/g,
      "_"
    )}.pdf`;

    const body = new Uint8Array(pdfBuffer.byteLength);
    body.set(pdfBuffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generando PDF EP:", error);
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    );
  }
}
