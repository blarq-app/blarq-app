import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { cargarCartola } from "@/lib/contabilidad/cartolaConciliadaDatos";
import { leerPeriodo, periodoParam } from "@/lib/contabilidad/periodo";
import { buildCartolaConciliadaXLSX } from "@/lib/xlsx/CartolaConciliadaXLSX";
import {
  pieCartolaConciliada,
  renderCartolaConciliadaHtml,
} from "@/lib/pdf/CartolaConciliadaPDF.html";

// Cartola conciliada, para el contador (pendiente 196):
//   GET /api/contabilidad/cartola?periodo=2026-07&formato=xlsx   → el Excel de un mes
//   GET /api/contabilidad/cartola?periodo=2026-07&formato=pdf    → el PDF de un mes
//   GET /api/contabilidad/cartola?periodo=2026&formato=xlsx      → el año completo
//
// SOLO LEE. Los dos salen del mismo armado (cargarCartola), así el Excel, el
// PDF y la pantalla de Contabilidad → Cartola dicen exactamente lo mismo.

// El PDF levanta un Chromium; mismo techo que los otros PDF de la app. El del
// año completo es el más pesado (2026 hasta octubre: 78 hojas, ~17 s en local
// contando la lectura de la base).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const periodo = leerPeriodo(sp.get("periodo"));
  if (!periodo) {
    return NextResponse.json({ error: "Falta el período: YYYY-MM (un mes) o YYYY (el año)" }, { status: 400 });
  }
  const { year, month } = periodo;
  const formato = sp.get("formato") === "pdf" ? "pdf" : "xlsx";
  const nombre = `Cartola_conciliada_${periodoParam(periodo)}_BLARQ`;

  try {
    const cartola = await cargarCartola(prisma, year, month);

    if (formato === "xlsx") {
      const buffer = await buildCartolaConciliadaXLSX(cartola);
      const body = new Uint8Array(buffer.byteLength);
      body.set(new Uint8Array(buffer));
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
        },
      });
    }

    // Apaisado: el tamaño y el margen los fija el @page del HTML.
    const pdf = await renderPDF(renderCartolaConciliadaHtml(cartola, new Date()), {
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: pieCartolaConciliada(cartola),
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
    console.error("Error generando la cartola conciliada:", error);
    return NextResponse.json({ error: "Error al generar la cartola conciliada" }, { status: 500 });
  }
}
