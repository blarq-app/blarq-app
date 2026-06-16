/**
 * Sube el DESGLOSE COMPLETO de una partida de la cotización al catálogo: todas
 * las líneas (materiales, mano de obra, herramientas, subcontrato, pérdida,
 * margen, leyes). Es el respaldo del botón "↑ Precios a catálogo + borradores":
 * hasta ahora ese botón solo mandaba los 6 montos globales (cost*), NO el
 * desglose — entonces una línea nueva (típicamente la PÉRDIDA que MJ agregaba)
 * nunca llegaba al desglose del catálogo, y como el catálogo recalcula sus
 * totales desde el desglose, el monto de pérdida se borraba solo después.
 *
 * Con este endpoint el catálogo queda igualito al desglose de la cotización:
 * actualiza las líneas que ya estaban (por vínculo o equivalencia) y crea las
 * nuevas, traduciendo el puntero de la pérdida. NO borra líneas que solo
 * existan en el catálogo (para no romper algo editado allá por sorpresa).
 *
 * La propagación de precios a las cotizaciones en borrador la sigue haciendo el
 * PUT de /api/catalogo/partidas/[id] (el front lo llama después de este).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  pushObraItemComponentsToCatalog,
  SinCatalogoError,
} from "@/lib/catalog/pushObraItemToCatalog";
import { requireSession } from "@/lib/apiAuth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { itemId } = await params;
    const { pushed, catalogPartidaId } =
      await pushObraItemComponentsToCatalog(itemId);
    return NextResponse.json({ ok: true, pushed, catalogPartidaId });
  } catch (error) {
    if (error instanceof SinCatalogoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error subiendo desglose al catálogo:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
