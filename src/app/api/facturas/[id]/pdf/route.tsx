import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { renderInvoiceHtml } from "@/lib/pdf/InvoicePDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        project: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }

    // Si tenemos el PDF oficial bajado del SII (vía sync local con cert),
    // lo servimos directo. Es el mismo PDF que muestra Maxxa, con todos los
    // ítems y formato del emisor. Si no, fallback al PDF interno generado
    // por nosotros con Puppeteer (resumen pero funcional).
    if (invoice.pdfContent) {
      const filename = `BLARQ_oficial_${invoice.tipoDoc ?? "doc"}_${
        invoice.folioNumber ?? invoice.id
      }.pdf`;
      const oficialBuf = Buffer.isBuffer(invoice.pdfContent)
        ? invoice.pdfContent
        : Buffer.from(invoice.pdfContent);
      const body = new Uint8Array(oficialBuf.byteLength);
      body.set(oficialBuf);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "X-PDF-Source": "sii-oficial",
        },
      });
    }

    const html = renderInvoiceHtml({
      type: invoice.type as "emitida" | "recibida",
      tipoDoc: invoice.tipoDoc,
      folioNumber: invoice.folioNumber,
      issueDate: invoice.issueDate,
      rutIssuer: invoice.rutIssuer,
      rutReceiver: invoice.rutReceiver,
      businessName: invoice.businessName,
      netAmount: invoice.netAmount,
      iva: invoice.iva,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      origin: invoice.origin,
      notes: invoice.notes,
      referenceFolioNumber: invoice.referenceFolioNumber,
      referenceTipoDoc: invoice.referenceTipoDoc,
      project: invoice.project,
      category: invoice.category,
      syncedAt: invoice.syncedAt,
    });

    const pdf = await renderPDF(html, {
      format: "A4",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });

    const filename = `BLARQ_${invoice.type}_${invoice.tipoDoc ?? "doc"}_${
      invoice.folioNumber ?? invoice.id
    }.pdf`;

    const body = new Uint8Array(pdf.byteLength);
    body.set(pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-PDF-Source": "interno",
      },
    });
  } catch (error) {
    console.error("Error generando PDF factura:", error);
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    );
  }
}
