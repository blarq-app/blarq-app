import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { renderGastosMesHtml } from "@/lib/pdf/GastosMesPDF.html";
import { listarGastosDelMes } from "@/lib/contabilidad/gastosMes";

// PDF mensual de los gastos sin documento del SII (boletas + internacionales):
//   GET /api/contabilidad/gastos/pdf?mes=2026-06[&fotos=0]
//
// Es un documento de SALIDA: lee los MISMOS gastos que muestra la pantalla
// /contabilidad/gastos con el mismo filtro (type=recibida, origin boleta o
// internacional, issueDate dentro del mes) y los suma tal cual. No recalcula
// nada ni escribe: el total del PDF tiene que dar idéntico al de la pantalla.

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Armar el PDF levanta un Chromium y mete todas las fotos del mes adentro: en
// un mes cargado tarda bastante más que el default de Vercel, que lo cortaría
// a mitad de camino. Mismo techo que los otros PDF de la app.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const m = (sp.get("mes") ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    return NextResponse.json(
      { error: "Falta el mes en formato YYYY-MM" },
      { status: 400 }
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) {
    return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
  }
  // Sin fotos = copia liviana, solo la planilla.
  const incluirFotos = sp.get("fotos") !== "0";

  const items = await listarGastosDelMes(prisma, year, month);

  const html = renderGastosMesHtml({
    mesNombre: MESES[month],
    year,
    items,
    emitidoEl: new Date(),
    incluirFotos,
  });

  try {
    const pdf = await renderPDF(html, { format: "A4" });
    const nombreArchivo = `Gastos_${year}-${String(month + 1).padStart(2, "0")}_BLARQ.pdf`;
    const body = new Uint8Array(pdf.byteLength);
    body.set(pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombreArchivo}"`,
      },
    });
  } catch (error) {
    console.error("Error generando el PDF de gastos:", error);
    return NextResponse.json(
      { error: "Error al generar el PDF" },
      { status: 500 }
    );
  }
}
