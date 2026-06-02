// Test de regresión de lib/richText.ts (descripciones con formato del
// cotizador). Cubre: la allowlist del sanitizador (formato OK, peligroso
// fuera), detección de vacío y conversión de texto plano viejo a HTML.
//
// Uso: npx tsx scripts/test-richtext.ts

import { sanitizeRichTextHtml, isRichTextEmpty, plainTextToHtml } from "../src/lib/richText";

let fails = 0;
function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) console.log(`    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
}

// --- sanitizeRichTextHtml: deja el formato permitido ---
check("negrita+cursiva intactas",
  sanitizeRichTextHtml("<p>Hola <strong>n</strong> <em>c</em></p>"),
  "<p>Hola <strong>n</strong> <em>c</em></p>");
check("viñetas intactas", sanitizeRichTextHtml("<ul><li>a</li><li>b</li></ul>"), "<ul><li>a</li><li>b</li></ul>");
check("lista numerada intacta", sanitizeRichTextHtml("<ol><li>a</li></ol>"), "<ol><li>a</li></ol>");
check("color permitido (normaliza espacio)",
  sanitizeRichTextHtml('<span style="color: #7c2d2d">x</span>'),
  '<span style="color:#7c2d2d">x</span>');

// --- sanitizeRichTextHtml: bloquea lo peligroso ---
check("script fuera", sanitizeRichTextHtml("<script>alert(1)</script><p>ok</p>"), "<p>ok</p>");
check("onclick fuera", sanitizeRichTextHtml('<p onclick="x">y</p>'), "<p>y</p>");
check("style no-color fuera (deja solo color)",
  sanitizeRichTextHtml('<span style="color:#7c2d2d;position:fixed">x</span>'),
  '<span style="color:#7c2d2d">x</span>');
check("img fuera", sanitizeRichTextHtml('<img src=x onerror=alert(1)>'), "");
check("anchor fuera, texto queda", sanitizeRichTextHtml('<a href="javascript:alert(1)">link</a>'), "link");
check("nulo → vacío", sanitizeRichTextHtml(null), "");

// --- isRichTextEmpty ---
check("vacío: <p></p>", isRichTextEmpty("<p></p>"), true);
check("vacío: null", isRichTextEmpty(null), true);
check("no vacío: texto", isRichTextEmpty("<p>hola</p>"), false);

// --- plainTextToHtml ---
check("texto plano con salto → <br>", plainTextToHtml("a\nb"), "<p>a<br>b</p>");
check("doble salto → párrafos", plainTextToHtml("a\n\nb"), "<p>a</p><p>b</p>");
check("ya es HTML → intacto", plainTextToHtml("<p>x</p>"), "<p>x</p>");
check("escapa < en texto plano", plainTextToHtml("a < b"), "<p>a &lt; b</p>");

console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLARON`);
process.exit(fails === 0 ? 0 : 1);
