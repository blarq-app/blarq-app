/**
 * Sube UNA línea (componente) de una partida de la cotización a la partida
 * equivalente del catálogo. Es la dirección inversa al sync normal
 * (catálogo → borradores): acá MJ decide, caso a caso, "esta línea que edité
 * o agregué, guárdala también en el catálogo para la próxima vez".
 *
 * Granularidad elegida por MJ (2026-06-01): "solo lo que toqué" — sube
 * únicamente esta línea, no la partida entera, y NO propaga a otras
 * cotizaciones (para eso está el botón de sync masivo).
 *
 * Caso especial PÉRDIDA: una pérdida es un "% sobre un material concreto". Si
 * subís solo la línea de pérdida, también se sube su material destino (sin él
 * la pérdida no se puede calcular en el catálogo) y se traduce el puntero al id
 * del material EN EL CATÁLOGO. Toda esa lógica vive en el helper compartido.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  pushObraItemComponentsToCatalog,
  SinCatalogoError,
} from "@/lib/catalog/pushObraItemToCatalog";
import { requireSession } from "@/lib/apiAuth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string; compId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId, compId } = await params;
    const { pushed } = await pushObraItemComponentsToCatalog(itemId, [compId]);
    return NextResponse.json({ ok: true, pushed });
  } catch (error) {
    if (error instanceof SinCatalogoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error subiendo componente al catálogo:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
