import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import {
  leerBoleta,
  partirDataUrl,
  MAX_BYTES,
} from "@/lib/contabilidad/leerBoleta";

// Lectura de la foto de una boleta:
//   POST /api/contabilidad/gastos/leer-boleta  { imagen: "data:image/jpeg;base64,..." }
//   → { numeroDoc, fecha, comercio, monto, confianza, nota }
//
// La lógica vive en @/lib/contabilidad/leerBoleta (así se puede probar con
// fotos reales desde un script). Acá solo se valida la entrada y se traducen
// los errores a algo que la pantalla pueda mostrar.
//
// Requiere ANTHROPIC_API_KEY en el entorno. En la mac de MJ ya está; en Vercel
// hay que cargarla a mano en las variables del proyecto.

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Falta la llave para leer fotos (ANTHROPIC_API_KEY). Cargá los datos a mano por ahora.",
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const imagen: unknown = body?.imagen;
  if (typeof imagen !== "string" || !imagen.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "Falta la foto (se espera un data URL de imagen)" },
      { status: 400 }
    );
  }
  if (imagen.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "La foto es muy pesada. Sacala de nuevo o achicala." },
      { status: 413 }
    );
  }

  const partes = partirDataUrl(imagen);
  if (!partes) {
    return NextResponse.json(
      { error: "Formato de imagen no soportado (usá JPG o PNG)" },
      { status: 400 }
    );
  }

  try {
    const datos = await leerBoleta(partes.mediaType, partes.base64);
    return NextResponse.json(datos);
  } catch (error) {
    console.error("Error leyendo la boleta:", error);
    return NextResponse.json(
      { error: "No se pudo leer la foto. Cargá los datos a mano." },
      { status: 502 }
    );
  }
}
