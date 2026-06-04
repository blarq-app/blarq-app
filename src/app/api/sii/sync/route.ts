import { NextRequest, NextResponse } from "next/server";
import { runSiiSync, getDefaultSyncFrom } from "@/lib/sii/runSiiSync";

// Botón "Sincronizar SII" en /facturas. Lee los DTEs directo del Registro de
// Compras y Ventas del SII (cert digital) y los upserta. Toda la lógica vive
// en runSiiSync (compartida con el script local scripts/sync-sii-dtes.ts).
//
// Query params:
//   ?from=YYYY-MM-DD  (opcional; si falta, la app lo deduce sola de la última
//                      factura ya traída — ver getDefaultSyncFrom)
//   ?to=YYYY-MM-DD    (opcional, default = hoy)
//   ?type=emitida|recibida (opcional, si falta hace ambos)
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // Sin ?from el botón no manda fecha: la app calcula sola desde cuándo
    // traer, mirando la factura del SII más reciente que ya tiene.
    const fromDate = searchParams.get("from") ?? (await getDefaultSyncFrom());
    const toDate = searchParams.get("to") ?? undefined;
    const typeFilter = searchParams.get("type") as
      | "emitida"
      | "recibida"
      | null;
    const types = typeFilter ? [typeFilter] : undefined;

    const result = await runSiiSync({ fromDate, toDate, types });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error sincronizando SII:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al sincronizar SII",
      },
      { status: 500 }
    );
  }
}
