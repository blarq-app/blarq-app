import { NextRequest, NextResponse } from "next/server";
import { runSiiSync } from "@/lib/sii/runSiiSync";

// Botón "Sincronizar SII" en /facturas. Lee los DTEs directo del Registro de
// Compras y Ventas del SII (cert digital) y los upserta. Toda la lógica vive
// en runSiiSync (compartida con el script local scripts/sync-sii-dtes.ts).
//
// Query params:
//   ?from=YYYY-MM-DD  (opcional, default = primer día del mes actual)
//   ?to=YYYY-MM-DD    (opcional, default = hoy)
//   ?type=emitida|recibida (opcional, si falta hace ambos)
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromDate =
      searchParams.get("from") ??
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .slice(0, 10);
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
