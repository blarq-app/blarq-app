// Lee una foto de factura electrónica chilena y extrae los datos que
// identifican el DTE: RUT del emisor, folio, total y fecha.
//
// Usa la API de Claude (visión) por HTTP directo — sin SDK, para no sumar
// dependencias. La clave vive en ANTHROPIC_API_KEY.
//
// Por qué solo estos campos: la app identifica cada factura por
// (rutIssuer, folioNumber). Con eso encontramos la factura que el SII trae
// por su lado; el total y la fecha son respaldo para confirmar el match
// (la lectura de un folio chico/borroso no es 100% confiable).
//
// NO leemos el "centro de costo" de la foto: la obra la dice MJ/JT en el
// texto del mensaje (más confiable que letra manuscrita sobre el papel).

import { normalizeRut } from "@/lib/clients/rut";

// Modelo barato y rápido para una tarea de lectura acotada. La factura
// electrónica tiene el folio y el RUT en recuadros estándar — no hace falta
// el modelo más caro.
const MODEL = "claude-haiku-4-5-20251001";

export interface InvoicePhotoData {
  rutIssuer: string | null; // normalizado 12345678-9
  folioNumber: string | null;
  totalAmount: number | null;
  issueDate: string | null; // YYYY-MM-DD
  businessName: string | null;
  // Confianza declarada por el modelo (0-1) sobre folio+rut. Sirve para
  // decidir si pedir confirmación humana antes de aplicar.
  confidence: number | null;
  // Texto MANUSCRITO sobre el papel (típicamente JT anota el nombre de la
  // obra a lápiz/lapicera). null si no hay nada escrito a mano. Como la
  // lectura de manuscrito es menos confiable que el texto tipeado en el
  // mensaje, el webhook lo usa solo si MJ/JT NO escribieron la obra como
  // caption, y SIEMPRE pide confirmación antes de asignar.
  handwrittenNote: string | null;
}

const SYSTEM_PROMPT = `Eres un lector de facturas electrónicas chilenas (DTE).
Te dan la foto de una factura o boleta. Extrae SOLO estos datos del EMISOR
(el proveedor que vende, NO el receptor/cliente):

- rutIssuer: RUT del emisor del documento (el proveedor). Formato con guión.
- folioNumber: el número de folio del documento (suele estar en el recuadro
  rojo arriba a la derecha, junto a "R.U.T." y el tipo de documento).
- totalAmount: el TOTAL a pagar en pesos chilenos, como número entero sin
  puntos ni símbolos.
- issueDate: fecha de emisión en formato YYYY-MM-DD.
- businessName: razón social del emisor.
- confidence: tu confianza de 0 a 1 en que leíste bien rutIssuer y folioNumber.
- handwrittenNote: si hay texto ESCRITO A MANO sobre el papel (a lápiz o
  lapicera, por encima de lo impreso — típicamente el nombre de una obra o
  proyecto anotado por la persona que compró), transcribilo tal cual lo leas.
  Es SOLO el texto manuscrito, NO el texto impreso de la factura. Si no hay
  nada escrito a mano, poné null.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin
markdown. Si un campo no se puede leer, ponlo en null. Ejemplo:
{"rutIssuer":"76123456-7","folioNumber":"12345","totalAmount":45990,"issueDate":"2026-05-31","businessName":"SODIMAC S.A.","confidence":0.95,"handwrittenNote":"Portofino"}`;

/**
 * Lee la foto y devuelve los datos del DTE. Lanza si falta la API key o si
 * la respuesta no se puede interpretar (el webhook lo captura y avisa).
 */
export async function readInvoicePhoto(
  imageBase64: string,
  mediaType: string
): Promise<InvoicePhotoData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta ANTHROPIC_API_KEY en el entorno");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Extrae los datos de esta factura como JSON.",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`API de Claude falló: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";

  // El modelo a veces envuelve el JSON en ```json ... ```; extraemos el
  // primer objeto {...} que aparezca.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `No se pudo leer la factura. Respuesta: ${text.slice(0, 200)}`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(
      `Respuesta de la IA no es JSON válido: ${match[0].slice(0, 200)}`
    );
  }

  const rawRut =
    typeof parsed.rutIssuer === "string" && parsed.rutIssuer.trim()
      ? parsed.rutIssuer
      : null;

  return {
    rutIssuer: rawRut ? normalizeRut(rawRut) : null,
    folioNumber:
      parsed.folioNumber != null ? String(parsed.folioNumber).trim() : null,
    totalAmount:
      typeof parsed.totalAmount === "number" ? parsed.totalAmount : null,
    issueDate: typeof parsed.issueDate === "string" ? parsed.issueDate : null,
    businessName:
      typeof parsed.businessName === "string" ? parsed.businessName : null,
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : null,
    handwrittenNote:
      typeof parsed.handwrittenNote === "string" && parsed.handwrittenNote.trim()
        ? parsed.handwrittenNote.trim()
        : null,
  };
}
