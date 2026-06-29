import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { getPlanillaPreviredMes } from "@/lib/contabilidad/remuneraciones";
import { generarArchivoPrevired } from "@/lib/contabilidad/previredArchivo";

// Código de la Mutual de BLARQ (Tabla N°19 Previred): 02 = Mutual de Seguridad
// CCHC (la de la construcción). A CONFIRMAR con la carga de prueba en Previred.
const MUTUAL_CODIGO_BLARQ = "02";

// Archivo de pago de cotizaciones para subir a Previred (formato 105 campos).
//   GET /api/contabilidad/previred/archivo?year=2026&month=5
export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  if (!year || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
  }

  const planilla = await getPlanillaPreviredMes(year, month);
  if (!planilla) {
    return NextResponse.json(
      { error: "No hay indicadores cargados para ese mes" },
      { status: 404 }
    );
  }

  const empleados = await prisma.empleado.findMany({ where: { activo: true } });
  const items = planilla.empleados
    .map((cot) => {
      const e = empleados.find((x) => x.rut === cot.rut);
      if (!e) return null;
      return {
        emp: {
          rut: e.rut,
          sexo: e.sexo,
          apellidoPaterno: e.apellidoPaterno,
          apellidoMaterno: e.apellidoMaterno,
          nombres: e.nombres,
          afpNombre: e.afpNombre,
          isapreCodigo: e.isapreCodigo,
          isapreFun: e.isapreFun,
          isaprePlanUF: e.isaprePlanUF,
        },
        cot,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const contenido = generarArchivoPrevired(items, {
    year,
    month,
    mutualCodigo: MUTUAL_CODIGO_BLARQ,
  });

  const nombre = `Previred_BLARQ_${year}${String(month).padStart(2, "0")}.txt`;
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}
