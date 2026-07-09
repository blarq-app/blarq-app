import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { grossUpSueldoMes } from "@/lib/contabilidad/remuneraciones";

// Preview del gross-up (NO guarda nada): dado un líquido a pagar, devuelve el
// sueldo imponible (base+bono) que hay que registrar para que la liquidación
// dé ese líquido, y el líquido efectivo resultante (la ida-y-vuelta).
//
//   POST { empleadoId, year, month, liquido } -> { imponible, liquidoResultante }
//
// La pantalla lo usa en modo "Líquido" para mostrar en vivo el imponible que se
// va a guardar antes de que MJ apriete Guardar.
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const data = await request.json();
  const empleadoId = String(data.empleadoId ?? "");
  const year = Number(data.year);
  const month = Number(data.month);
  const liquido = Math.round(Number(data.liquido) || 0);

  if (!empleadoId || !year || month < 1 || month > 12 || liquido <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const res = await grossUpSueldoMes(empleadoId, year, month, liquido);
  if (!res) {
    return NextResponse.json(
      { error: "No hay indicadores (UF/UTM) cargados para ese mes" },
      { status: 400 }
    );
  }
  return NextResponse.json(res);
}
