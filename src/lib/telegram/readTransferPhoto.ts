// Lee el pantallazo de un comprobante de transferencia bancaria y extrae los
// datos que identifican el traspaso: fecha, monto, destino y banco.
//
// Mismo molde que readInvoicePhoto (API de Claude por HTTP directo, sin SDK,
// clave en ANTHROPIC_API_KEY). Lo que cambia es QUÉ se lee: acá no hay RUT
// emisor ni folio — una transferencia entre dos cuentas propias se identifica
// por fecha + monto.
//
// El campo `esComprobante` es la red de seguridad del ruteo por chat: el bot
// atiende dos chats con el mismo token (uno de facturas, uno de traspasos), y
// si en el de traspasos entra por error la foto de una factura, preferimos
// avisar antes que guardar una etiqueta con datos que no son de un traspaso.

const MODEL = "claude-haiku-4-5-20251001";

export interface TransferPhotoData {
  // Fecha de la transferencia, YYYY-MM-DD.
  transferDate: string | null;
  // Monto transferido en pesos, entero sin puntos.
  amount: number | null;
  // A qué cuenta / a nombre de quién fue, tal como sale en el comprobante.
  destination: string | null;
  bankName: string | null;
  // false cuando la imagen NO parece un comprobante de transferencia (una
  // factura, una boleta, un pantallazo cualquiera).
  esComprobante: boolean;
  // Qué se ve en la imagen, en pocas palabras. Solo se usa para explicarle a
  // MJ por qué el bot no guardó nada cuando esComprobante es false.
  queEs: string | null;
  // Confianza declarada por el modelo (0-1) sobre fecha + monto.
  confidence: number | null;
}

const SYSTEM_PROMPT = `Eres un lector de comprobantes de transferencia bancaria
chilenos (Santander, Banco de Chile, BCI, etc.). Te dan el pantallazo de un
comprobante y extraes los datos de la transferencia.

Devuelve estos campos:

- esComprobante: true si la imagen ES un comprobante/constancia de una
  transferencia bancaria (dice "Transferencia exitosa", "Comprobante de
  transferencia", muestra monto transferido, cuenta de destino, fecha). false si
  es otra cosa — por ejemplo una FACTURA o BOLETA de un proveedor (tiene RUT
  emisor, folio, detalle de productos, IVA), una cartola, o cualquier otra
  imagen.
- queEs: en pocas palabras, qué se ve en la imagen (ej "comprobante de
  transferencia Santander", "factura de Sodimac", "foto de una pared"). Siempre
  responde este campo.
- transferDate: fecha de la transferencia en formato YYYY-MM-DD. Si el
  comprobante trae fecha y hora, usa solo la fecha.
- amount: el monto transferido en pesos chilenos, como número entero sin puntos
  ni símbolos.
- destination: a qué cuenta o a nombre de quién se transfirió, tal como aparece
  (ej "Cuenta Corriente 9987891-6", "BLARQ SPA").
- bankName: el banco del comprobante.
- confidence: tu confianza de 0 a 1 en que leíste bien transferDate y amount.

Si esComprobante es false, pon en null los demás campos salvo queEs.
Si un campo no se puede leer, ponlo en null.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin
markdown. Ejemplo:
{"esComprobante":true,"queEs":"comprobante de transferencia Santander","transferDate":"2026-08-13","amount":2500000,"destination":"Cuenta Corriente 0-000-9987891-6","bankName":"Santander","confidence":0.96}`;

/**
 * Lee el comprobante y devuelve sus datos. Lanza si falta la API key o si la
 * respuesta no se puede interpretar (el webhook lo captura y avisa).
 */
export async function readTransferPhoto(
  imageBase64: string,
  mediaType: string
): Promise<TransferPhotoData> {
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
              text: "Extrae los datos de este comprobante como JSON.",
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

  // El modelo a veces envuelve el JSON en ```json ... ```; extraemos el primer
  // objeto {...} que aparezca.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `No se pudo leer el comprobante. Respuesta: ${text.slice(0, 200)}`
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

  const texto = (k: string): string | null =>
    typeof parsed[k] === "string" && (parsed[k] as string).trim()
      ? (parsed[k] as string).trim()
      : null;

  return {
    // Solo aceptamos una fecha con formato reconocible; cualquier otra cosa es
    // un dato que después no vamos a poder matchear contra el banco.
    transferDate: (() => {
      const f = texto("transferDate");
      return f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
    })(),
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    destination: texto("destination"),
    bankName: texto("bankName"),
    // Ante duda del modelo (campo ausente o raro), asumimos que NO es
    // comprobante: preferimos preguntar antes que guardar cualquier cosa.
    esComprobante: parsed.esComprobante === true,
    queEs: texto("queEs"),
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : null,
  };
}
