import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { computeEstadoResultadoAnual } from "@/lib/dashboard/estadoResultado";

// GET /api/dashboard/estado-resultado?year=2026
// Devuelve el Estado de Resultado Anual (mensual, todo el estudio) para el
// año pedido. Lo consume el gráfico del dashboard cuando MJ cambia de año.
export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const yearParam = request.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Año inválido" }, { status: 400 });
  }

  const data = await computeEstadoResultadoAnual(year);
  return NextResponse.json(data);
}
