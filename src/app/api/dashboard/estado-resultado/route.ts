import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { computeEstadoResultadoFacturacion } from "@/lib/dashboard/estadoResultado";
import { computeEstadoResultadoCaja } from "@/lib/dashboard/estadoResultadoCaja";

// GET /api/dashboard/estado-resultado?year=2026
// Devuelve las dos vistas del Estado de Resultado para el año pedido:
//   - facturacion: lo que se declara al SII (solo facturas / DTE)
//   - caja: la plata real del banco (estilo Maxxa)
// Lo consume el gráfico del dashboard cuando MJ cambia de año o de vista.
export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const yearParam = request.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Año inválido" }, { status: 400 });
  }

  const [facturacion, caja] = await Promise.all([
    computeEstadoResultadoFacturacion(year),
    computeEstadoResultadoCaja(year),
  ]);
  return NextResponse.json({ facturacion, caja });
}
