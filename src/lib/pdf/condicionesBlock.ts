/**
 * Bloque "Observaciones generales" de los tres PDF al cliente (obra, muebles,
 * artefactos). Antes cada plantilla tenía su propia lista fija; ahora las tres
 * imprimen las condiciones de la versión, con el mismo markup.
 *
 * Si la lista viene vacía el bloque NO se dibuja: no queda el título colgado
 * sin nada abajo. "Lo que ves en la cotización es lo que sale."
 */
import type { Condicion } from "@/lib/presupuesto/condiciones";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param listClass  clase del contenedor de la lista — cada PDF tiene la suya
 *                   ("obs-grid" en obra, "obs-list" en muebles/artefactos).
 */
export function renderCondicionesHTML(
  condiciones: Condicion[],
  listClass: string
): string {
  if (!condiciones.length) return "";
  const items = condiciones
    .map(
      (c, i) =>
        `<div class="obs-item"><span class="obs-num">${i + 1}</span><span>${
          c.lead ? `<b>${esc(c.lead)}</b> ` : ""
        }${esc(c.text)}</span></div>`
    )
    .join("");
  return `<div class="obs">
        <div class="blk-title">Observaciones generales</div>
        <div class="${listClass}">${items}</div>
      </div>`;
}
