// Utilidades para las descripciones con formato (negrita, cursiva, listas,
// color) del cotizador. El texto se edita con Tiptap (ver RichTextEditor.tsx)
// y se guarda como HTML en los mismos campos descriptionCliente /
// descriptionMaestro (sin cambio de schema).
//
// El HTML lo generan SOLO usuarios autenticados (MJ/JT) a través del editor,
// que limita las marcas posibles. Aun así, antes de inyectarlo en pantalla o
// en los PDF (render server-side con Puppeteer) lo pasamos por una allowlist
// conservadora: deja solo las etiquetas de formato esperadas y, en <span>,
// solo el color. Todo lo demás (scripts, atributos, on*, estilos raros) se cae.

// Etiquetas de formato permitidas. El resto se elimina conservando el texto
// interior (no se pierde contenido, solo el marcado no permitido).
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "s", "u", "ul", "ol", "li", "span",
]);

/**
 * Limpia el HTML de una descripción dejándolo seguro para inyectar.
 * - Borra bloques peligrosos completos (script/style/iframe/etc.).
 * - Deja solo las etiquetas de la allowlist; en <span> conserva solo `color`.
 * - Elimina cualquier otro atributo (incluidos on* y estilos no-color).
 */
export function sanitizeRichTextHtml(html: string | null | undefined): string {
  if (!html) return "";
  let out = html;

  // 1. Eliminar elementos peligrosos con todo su contenido.
  out = out.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|svg|img)[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
  // 2. Y sus variantes auto-cerradas / sin cierre.
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|img)[^>]*>/gi, "");

  // 3. Procesar cada etiqueta restante contra la allowlist.
  out = out.replace(/<(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (_m, slash: string, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return ""; // etiqueta no permitida → fuera (texto interno se queda)
    if (slash) return `</${t}>`;
    if (t === "span") {
      // En span dejamos SOLO color (de la paleta del editor). Acepta #hex o rgb().
      const m = /(?:^|[;"'\s])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\))/i.exec(attrs);
      return m ? `<span style="color:${m[1]}">` : "<span>";
    }
    return `<${t}>`; // resto: sin atributos
  });

  return out;
}

/**
 * ¿La descripción con formato está vacía? (para guardar null en vez de "<p></p>").
 * Mira solo el texto visible: ignora etiquetas, &nbsp; y espacios.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  return text.length === 0;
}

/**
 * Normaliza un valor guardado para cargarlo en el editor. Las descripciones
 * viejas son texto plano (sin etiquetas) y pueden traer saltos de línea: las
 * convertimos a HTML simple para que el editor las muestre bien. Si ya es HTML
 * (tiene una etiqueta de bloque/marca), se devuelve tal cual.
 */
export function plainTextToHtml(value: string | null | undefined): string {
  if (!value) return "";
  if (/<(p|br|ul|ol|li|strong|em|span|b|i)\b/i.test(value)) return value; // ya es HTML
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * HTML del editor → texto plano. Para el Excel, que escribe el valor tal cual
 * en la celda y no entiende etiquetas: sin esto, una descripción con formato
 * le llega al maestro como `<p><span style="color:...">TEXTO</span></p>`.
 * Los cortes de bloque (`</p>`, `<br>`, `<li>`) se conservan como salto de
 * línea, que en la celda se ve gracias al `wrapText`.
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*(br|\/p|\/li|\/ul|\/ol)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "· ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&") // último: si no, re-decodifica lo anterior
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
