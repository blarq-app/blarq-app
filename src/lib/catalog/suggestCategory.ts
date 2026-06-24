/**
 * Sugerencia de categoría para un material del catálogo, usando Claude.
 *
 * Mismo patrón y modelo que el lector de fotos de facturas
 * (src/lib/telegram/readInvoicePhoto.ts): llamada directa a la API de
 * Anthropic con la clave de ANTHROPIC_API_KEY, sin SDK.
 *
 * REGLA DE NEGOCIO: la lista de categorías es CERRADA — el modelo elige el
 * rubro existente más parecido y NUNCA inventa uno nuevo. Si no hay clave o
 * algo falla, devolvemos null y la UI deja que MJ elija a mano (nunca
 * bloquea el alta).
 */

const MODEL = "claude-haiku-4-5-20251001";

export async function suggestMaterialCategory(
  name: string,
  categories: string[]
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!name.trim() || categories.length === 0) return null;

  const system =
    "Sos un clasificador de materiales de construcción para un estudio de " +
    "arquitectura chileno. Te doy el nombre de un producto y una lista CERRADA " +
    "de categorías que ya existen. Elegí la que mejor calza. REGLAS: respondé " +
    "SOLO con el nombre EXACTO de una categoría de la lista, tal cual está " +
    "escrita (mismas mayúsculas y acentos). NUNCA inventes una categoría nueva " +
    "ni agregues texto extra. Si ninguna calza perfecto, elegí igual la más " +
    "parecida.";

  const user =
    `Producto: "${name}"\n\n` +
    "Categorías disponibles (elegí UNA, exactamente como está):\n" +
    categories.map((c) => `- ${c}`).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 40,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text =
      data.content
        ?.find((c) => c.type === "text")
        ?.text?.trim()
        .replace(/^["'\s-]+|["'\s.]+$/g, "") ?? "";
    if (!text) return null;

    // Defensa: aceptamos la respuesta SOLO si coincide con una categoría real
    // de la lista (match exacto, o sin distinguir mayúsculas/acentos). Si el
    // modelo devolvió algo que no está en la lista, preferimos null antes que
    // crear un rubro fantasma.
    const exact = categories.find((c) => c === text);
    if (exact) return exact;
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const loose = categories.find((c) => norm(c) === norm(text));
    return loose ?? null;
  } catch {
    return null;
  }
}
