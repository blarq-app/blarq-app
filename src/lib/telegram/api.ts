// Cliente mínimo de la Bot API de Telegram.
//
// Solo lo que necesita el bot de captura de centro de costo: responder
// mensajes y bajar la foto que mandó MJ/JT. No usamos ninguna librería —
// la Bot API es HTTP plano, así evitamos una dependencia más (igual que se
// decidió para leer el SII directo sin SimpleFactura).
//
// El token vive en TELEGRAM_BOT_TOKEN (.env local / env var en Vercel).
// Es como una contraseña del bot: nunca se commitea.

const API_BASE = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN en el entorno");
  return t;
}

/**
 * Manda un mensaje de texto a un chat de Telegram.
 * parseMode "Markdown" permite *negrita* simple en la confirmación.
 */
export async function sendMessage(
  chatId: number | string,
  text: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!res.ok) {
    // No reventamos el webhook por un fallo al responder — lo logueamos.
    console.warn("[telegram] sendMessage falló:", res.status, await res.text());
  }
}

/**
 * Resuelve el file_path de un file_id (paso 1 para bajar un archivo).
 * Telegram entrega los archivos en dos pasos: getFile → download.
 */
async function getFilePath(fileId: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/bot${token()}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!res.ok) {
    throw new Error(`getFile falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const path = data.result?.file_path;
  if (!path) throw new Error("getFile no devolvió file_path");
  return path;
}

/**
 * Baja un archivo de Telegram por su file_id y lo devuelve como base64
 * (lo que necesita la API de Claude para leer la imagen) + su mime.
 */
export async function downloadFileAsBase64(
  fileId: string
): Promise<{ base64: string; mediaType: string }> {
  const filePath = await getFilePath(fileId);
  const res = await fetch(`${API_BASE}/file/bot${token()}/${filePath}`);
  if (!res.ok) {
    throw new Error(`download falló: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Telegram comprime las fotos a JPEG; el file_path trae la extensión real.
  const mediaType = filePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";
  return { base64: buf.toString("base64"), mediaType };
}

/**
 * Registra el webhook del bot apuntando a la URL pública dada.
 * Se corre una vez al desplegar (o desde un script). Telegram empieza a
 * mandar los mensajes a esa URL.
 *
 * secretToken (opcional): Telegram lo manda en cada request como header
 * X-Telegram-Bot-Api-Secret-Token. El webhook lo valida para asegurar que
 * el request viene de Telegram y no de un tercero que conoce la URL.
 */
export async function setWebhook(
  url: string,
  secretToken?: string
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/bot${token()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      allowed_updates: ["message"],
      ...(secretToken ? { secret_token: secretToken } : {}),
    }),
  });
  return res.json();
}
