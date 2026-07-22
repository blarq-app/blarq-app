import Anthropic from "@anthropic-ai/sdk";

// Lectura de la foto de una boleta chilena: devuelve número, fecha, comercio y
// monto para que MJ solo revise en vez de tipear.
//
// La app no sabe leer imágenes por sí sola — la foto se le manda a Claude, que
// responde en un formato fijo (structured outputs, así no hay que interpretar
// texto libre). Cuesta unos centavos de dólar por foto.
//
// Lo que devuelve es una PROPUESTA: la pantalla la muestra editable y el monto
// se cuadra siempre contra el movimiento del banco. Si la foto está mala, los
// campos vuelven en null y se cargan a mano — nunca se inventa un valor.
//
// Vive en /lib y no dentro del endpoint para poder probarlo con fotos reales
// desde un script (scripts/test-leer-boleta.ts) sin levantar el server.

export interface BoletaLeida {
  numeroDoc: string | null;
  fecha: string | null; // YYYY-MM-DD
  comercio: string | null;
  monto: number | null; // pesos, sin decimales
  confianza: "alta" | "media" | "baja";
  nota: string | null;
}

// Formato fijo de la respuesta. Todo puede venir null: es preferible que la
// pantalla muestre el campo vacío a que se invente un dato que después termina
// en la contabilidad.
const ESQUEMA = {
  type: "object",
  properties: {
    numeroDoc: {
      type: ["string", "null"],
      description:
        "Número de la boleta tal como está impreso, sin puntos ni prefijos. null si no se ve.",
    },
    fecha: {
      type: ["string", "null"],
      description:
        "Fecha de emisión en formato YYYY-MM-DD. null si no se ve o no se entiende.",
    },
    comercio: {
      type: ["string", "null"],
      description:
        "Nombre del comercio o proveedor, como aparece en la boleta. null si no se ve.",
    },
    monto: {
      type: ["integer", "null"],
      description:
        "Total pagado en pesos chilenos, sin separadores ni decimales. Es el TOTAL final, no el neto ni un ítem suelto. null si no se ve.",
    },
    confianza: {
      type: "string",
      enum: ["alta", "media", "baja"],
      description:
        "alta = todos los campos claros; media = alguno dudoso; baja = foto ilegible o no parece una boleta.",
    },
    nota: {
      type: ["string", "null"],
      description:
        "Una frase en español si hay algo que la persona deba revisar (foto cortada, monto borroso, no parece boleta). null si está todo bien.",
    },
  },
  required: ["numeroDoc", "fecha", "comercio", "monto", "confianza", "nota"],
  additionalProperties: false,
} as const;

const INSTRUCCIONES = `Sos un asistente que lee fotos de boletas y comprobantes chilenos para una empresa constructora.

Extraé solo lo que se VE en la imagen. Si un dato no se lee con seguridad, devolvé null en ese campo — nunca lo deduzcas ni lo inventes.

Detalles del formato chileno:
- El total suele estar abajo, precedido por "TOTAL". Ignorá subtotales, "NETO", "IVA" y los precios de cada producto.
- Los montos vienen con punto como separador de miles ($27.303 son veintisiete mil trescientos tres, no 27,303).
- Las fechas suelen venir DD/MM/AAAA o DD-MM-AAAA. Convertilas a AAAA-MM-DD.
- El número de boleta puede aparecer como "BOLETA N°", "Nro", "Folio" o similar.
- Si la imagen es un cargo de tarjeta o un comprobante de transferencia en vez de una boleta, igual extraé lo que puedas y avisá en la nota.`;

export const MEDIA_SOPORTADOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// Tamaño máximo del data URL que aceptamos. Una foto comprimida por el
// navegador anda en ~150 KB; 5 MB es un techo generoso que evita que un
// archivo enorme cuelgue el request.
export const MAX_BYTES = 5 * 1024 * 1024;

export class BoletaIlegible extends Error {}

export async function leerBoleta(
  mediaType: string,
  base64: string
): Promise<BoletaLeida> {
  const client = new Anthropic();

  const respuesta = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system: INSTRUCCIONES,
    // Sin thinking: es una extracción directa de lo que se ve, no un problema
    // que requiera razonar. Menos latencia y menos costo por foto.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ESQUEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg",
              data: base64,
            },
          },
          { type: "text", text: "Leé esta boleta y devolvé los datos." },
        ],
      },
    ],
  });

  if (respuesta.stop_reason === "refusal") {
    throw new BoletaIlegible("La lectura fue rechazada");
  }
  const texto = respuesta.content.find((b) => b.type === "text");
  if (!texto || texto.type !== "text") {
    throw new BoletaIlegible("La lectura no devolvió datos");
  }
  return JSON.parse(texto.text) as BoletaLeida;
}

// Parte un data URL en (mediaType, base64) validando que sea una imagen de las
// que aceptamos. Devuelve null si no calza.
export function partirDataUrl(
  dataUrl: string
): { mediaType: string; base64: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m || !MEDIA_SOPORTADOS.includes(m[1])) return null;
  return { mediaType: m[1], base64: m[2] };
}
