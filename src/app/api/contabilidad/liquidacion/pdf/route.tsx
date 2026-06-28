import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { computeLiquidacion } from "@/lib/contabilidad/sueldos";
import { renderLiquidacionHtml } from "@/lib/pdf/LiquidacionPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// PDF de la liquidación de sueldo de un empleado en un mes.
//   GET /api/contabilidad/liquidacion/pdf?year=2026&month=5&empleadoId=...
export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  const empleadoId = sp.get("empleadoId");

  if (!year || month < 1 || month > 12 || !empleadoId) {
    return NextResponse.json(
      { error: "Faltan year/month/empleadoId" },
      { status: 400 }
    );
  }

  const [empleado, indicador] = await Promise.all([
    prisma.empleado.findUnique({ where: { id: empleadoId } }),
    prisma.indicadorMensual.findUnique({
      where: { year_month: { year, month } },
    }),
  ]);

  if (!empleado) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }
  if (!indicador) {
    return NextResponse.json(
      { error: `No hay indicadores cargados para ${MESES[month - 1]} ${year}` },
      { status: 404 }
    );
  }

  const liquidacion = computeLiquidacion(
    {
      nombre: empleado.nombre,
      rut: empleado.rut,
      sueldoBase: empleado.sueldoBase,
      colacion: empleado.colacion,
      movilizacion: empleado.movilizacion,
      afpComisionRate: empleado.afpComisionRate,
      isaprePlanUF: empleado.isaprePlanUF,
    },
    {
      uf: indicador.uf,
      utm: indicador.utm,
      gratificacionTopeMensual: indicador.gratificacionTopeMensual,
      topeImponibleSaludUF: indicador.topeImponibleSaludUF,
    }
  );

  const html = renderLiquidacionHtml({
    liquidacion,
    afpNombre: empleado.afpNombre,
    isapreNombre: empleado.isapreNombre,
    isaprePlanUF: empleado.isaprePlanUF,
    mesNombre: MESES[month - 1],
    year,
    uf: indicador.uf,
    utm: indicador.utm,
  });

  try {
    const pdf = await renderPDF(html, { format: "A4" });
    const nombreArchivo = `Liquidacion_${empleado.nombre.replace(/\s+/g, "_")}_${year}-${String(month).padStart(2, "0")}.pdf`;
    const body = new Uint8Array(pdf.byteLength);
    body.set(pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombreArchivo}"`,
      },
    });
  } catch (error) {
    console.error("Error generando liquidación PDF:", error);
    return NextResponse.json(
      { error: "Error al generar el PDF" },
      { status: 500 }
    );
  }
}
