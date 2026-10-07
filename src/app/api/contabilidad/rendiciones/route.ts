import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { cargarRendiciones } from "@/lib/contabilidad/rendicionesDatos";
import { leerPeriodo, periodoParam } from "@/lib/contabilidad/periodo";
import { buildRendicionesXLSX } from "@/lib/xlsx/RendicionesXLSX";
import { pieRendiciones, renderRendicionesHtml } from "@/lib/pdf/RendicionesPDF.html";

// Rendiciones de gastos de los socios, para el contador:
//   GET /api/contabilidad/rendiciones?periodo=2026-10&formato=xlsx   → Excel de un mes
//   GET /api/contabilidad/rendiciones?periodo=2026&formato=pdf       → PDF del año
//
// SOLO LEE. Excel, PDF y la pantalla Contabilidad → Rendiciones salen del mismo
// armado (cargarRendiciones).

// El PDF levanta un Chromium; mismo techo que los otros PDF de la app.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const periodo = leerPeriodo(sp.get("periodo"));
  if (!periodo) {
    return NextResponse.json({ error: "Falta el período: YYYY-MM (un mes) o YYYY (el año)" }, { status: 400 });
  }
  const formato = sp.get("formato") === "pdf" ? "pdf" : "xlsx";
  const nombre = `Rendiciones_${periodoParam(periodo)}_BLARQ`;

  try {
    const rendiciones = await cargarRendiciones(prisma, periodo.year, periodo.month);

    if (formato === "xlsx") {
      const buffer = await buildRendicionesXLSX(rendiciones);
      const body = new Uint8Array(buffer.byteLength);
      body.set(new Uint8Array(buffer));
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
        },
      });
    }

    // A4 vertical: el tamaño y el margen los fija el @page del HTML.
    const pdf = await renderPDF(renderRendicionesHtml(rendiciones, new Date()), {
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: pieRendiciones(rendiciones),
    });
    const body = new Uint8Array(pdf.byteLength);
    body.set(pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombre}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generando las rendiciones:", error);
    return NextResponse.json({ error: "Error al generar las rendiciones" }, { status: 500 });
  }
}
