import { NextResponse } from "next/server";
import { linkNcReferences } from "@/lib/sii/linkNcReferences";
import { isMockMode } from "@/lib/sii/simpleFacturaClient";

// Re-linkea NCs recibidas que aún no tienen referenceFolioNumber, on-demand.
// Mismo flow que corre al final de /api/sii/sync, pero disparable solo
// (sin re-traer DTEs del SII). Útil cuando MJ vé NCs sueltas y quiere
// resolverlas sin esperar al próximo sync.
export async function POST() {
  if (isMockMode()) {
    return NextResponse.json(
      { error: "Re-link no disponible en modo mock (sin SII real)." },
      { status: 400 }
    );
  }
  try {
    const result = await linkNcReferences();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Error re-linkeando NCs:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al re-linkear NCs",
      },
      { status: 500 }
    );
  }
}
