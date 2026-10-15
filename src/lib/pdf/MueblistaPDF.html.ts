/**
 * PDF "Listado de herrajes para el mueblista" (Fase 3 herrajes, 2026-06-22).
 *
 * Es la SEGUNDA salida de la cotización de muebles: el mismo set de herrajes
 * pero SIN PRECIOS, para pasarle al mueblista y que sepa dónde va cada herraje
 * y cuántos (y, si BLARQ los compró, dónde se los consideró). Nombre +
 * medida/color + proveedor + ubicación + cantidad.
 *
 * Se ve IGUAL que la lista de la app (HerrajePartidaBlock), por pedido de MJ
 * (2026-09-30, pendiente 189): un bloque por capítulo, en el orden de MJ, y la
 * ubicación (campo `sector` de la línea) como una columna más — sin títulos
 * por ubicación. Si ninguna línea del documento tiene ubicación, la columna no
 * se imprime (sería una columna entera de "—").
 *
 * Marca v2 (pendiente 201, 2026-10-15): se ve como una hoja de detalle del
 * presupuesto de muebles, SIN portada — mismo encabezado (.dhead de
 * MueblesPDF, que copia el de ObraPDF), misma banda de capítulo y mismos
 * filetes. Sin la nota de "listado sin precios" (MJ la sacó) y apretado para
 * que una cotización normal (Algarrobos V4, 29 líneas) entre en 1 hoja; la
 * letra de la tabla no baja de 7 pt para que se lea impreso en el taller.
 *
 * Self-contained a propósito (no toca el PDF de muebles al cliente). Los
 * márgenes los pone el @page de acá: la ruta lo renderiza con
 * preferCSSPageSize, igual que el de muebles.
 */
import fs from "node:fs";
import path from "node:path";
import { formatHerrajeName } from "@/lib/presupuesto/herrajeNombre";

export interface MueblistaHerrajeInput {
  sector: string;
  name: string;
  measure: string | null;
  finish: string | null;
  supplier: string;
  quantity: number;
}

export interface MueblistaChapterInput {
  name: string;
  herrajes: MueblistaHerrajeInput[];
}

export interface MueblistaHTMLInput {
  project: { name: string; clientName: string; address?: string | null };
  budget: { version: string; date: string | Date };
  chapters: MueblistaChapterInput[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

// Misma fecha que el encabezado del presupuesto de muebles (15·10·2026).
function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}·${month}·${year}`;
}

function assetDataUri(file: string): string {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), "public", "assets", file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// Encabezado, márgenes y marca de agua: copiados tal cual de la hoja de detalle
// de MueblesPDF, para que puestos lado a lado se vean del mismo juego. La tabla
// usa la misma tipografía y filetes (raya de tinta bajo los títulos de columna,
// banda gris de capítulo, filete de 0,25 pt entre filas) pero con letra de
// 7,5 pt: el presupuesto se lee de cerca, este listado se imprime para el taller.
const CSS = `
  @page { size: A4; margin: 8.47mm 0 7.79mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Nunito Sans', sans-serif;
    color: #36322C;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { position: relative; width: 210mm; overflow: hidden; min-height: 280mm; }
  .pad-detail { position: relative; padding: 0 13.548mm; }
  .wm { position: absolute; right: -7.45mm; bottom: -11.85mm; z-index: 0; }
  .wm img { width: 50.806mm; opacity: .05; }

  .dhead-iso { width: 20.16pt; opacity: .55; margin-bottom: 14.4pt; display: block; }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; }
  .dhead > div { min-width: 0; }
  .dhead .kick { font-size: 5.28pt; letter-spacing: .26em; text-transform: uppercase; color: #9A9183; font-weight: 600; }
  .dhead .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 12.48pt; line-height: 1.2; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 2.88pt; }
  .dhead .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 6.72pt; color: #9A9183; margin-top: 1.92pt; }
  .dhead .right { text-align: right; flex-shrink: 0; max-width: 45%; }
  .dhead .ver { font-size: 4.8pt; letter-spacing: .28em; text-transform: uppercase; color: #b0a596; font-weight: 600; }
  .dhead .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 12.48pt; line-height: 1.2; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 2.88pt; }
  .dhead .docsub { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 6.24pt; letter-spacing: .34em; text-transform: uppercase; color: #9A9183; margin-top: 2.88pt; }

  /* Columnas: con y sin Ubicación (si nadie la cargó, no se imprime). */
  .t5 { --cols: 37% 19% 11% minmax(0, 1fr) 7%; }
  .t4 { --cols: 48% 26% minmax(0, 1fr) 8%; }
  .mhd, .hr { display: grid; grid-template-columns: var(--cols); column-gap: 8pt; }
  .mhd { padding: 3.84pt 0; border-bottom: .96pt solid #34332E; margin-top: 13.44pt; font-size: 5.5pt; letter-spacing: .1em; text-transform: uppercase; color: #9A9183; font-weight: 700; break-after: avoid; }
  .mhd .rt { text-align: right; }
  .cap { background: #EDEDEB; padding: 3.84pt 6.72pt; margin-top: 7pt; font-size: 6pt; letter-spacing: .14em; text-transform: uppercase; break-inside: avoid; break-after: avoid; }
  .mhd + .cap { margin-top: 4.8pt; }
  .cap b { font-weight: 700; color: #34332E; }
  .hr { align-items: baseline; padding: 3pt 0 2.6pt; position: relative; font-size: 7.5pt; line-height: 1.28; color: #5f5b52; break-inside: avoid; }
  /* Chromium redondea los bordes subpíxel a 1 px. Igual que en el presupuesto,
     se escala el trazo para imprimir un filete realmente fino (0,25 pt). */
  .hr::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 1pt; background: #D0D0D0;
    transform: scaleY(.25); transform-origin: bottom;
  }
  .hr > span { min-width: 0; overflow-wrap: anywhere; }
  .c-name { color: #34332E; }
  .c-prov { color: #aaa294; text-transform: uppercase; letter-spacing: .04em; font-size: 7pt; }
  .c-qty { text-align: right; color: #34332E; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* El "—" de un dato vacío no debe pesar como un dato. */
  .nil { color: #CFC9C0; }
  .empty { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 8pt; color: #9A9183; padding: 12pt 0; }
`;

function celda(valor: string, clase = ""): string {
  return valor
    ? `<span${clase ? ` class="${clase}"` : ""}>${esc(valor)}</span>`
    : `<span class="nil${clase ? ` ${clase}` : ""}">—</span>`;
}

function renderFilas(lines: MueblistaHerrajeInput[], conUbicacion: boolean): string {
  return lines
    .map((h) => {
      const spec = [h.measure, h.finish].filter(Boolean).join(" · ");
      const ubic = (h.sector ?? "").trim();
      // El nombre va con la escritura homologada (pendiente 139) con el mismo
      // helper que usa el editor, para que PDF y pantalla no puedan divergir.
      return `<div class="hr"><span class="c-name">${esc(formatHerrajeName(h.name))}</span>${celda(spec)}${celda(h.supplier, "c-prov")}${conUbicacion ? celda(ubic) : ""}<span class="c-qty">${fmtQty(h.quantity)}</span></div>`;
    })
    .join("");
}

export function renderMueblistaHTML(input: MueblistaHTMLInput): string {
  const { project, budget, chapters } = input;
  const iso = assetDataUri("blarq-isotipo-piedra.png");
  const versionLarga = `Versión ${budget.version.replace(/^V/i, "")} · ${fmtDate(budget.date)}`;
  const psub = [project.clientName, project.address]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");

  // Solo capítulos con herrajes, cada uno bajo su banda en el orden de MJ.
  // Los títulos de columna van una sola vez arriba, como en el presupuesto.
  const conUbicacion = chapters.some((ch) =>
    ch.herrajes.some((h) => (h.sector ?? "").trim() !== ""),
  );
  const body = chapters
    .filter((ch) => ch.herrajes.length > 0)
    .map(
      (ch) =>
        `<div class="cap"><b>${esc(ch.name)}</b></div>${renderFilas(ch.herrajes, conUbicacion)}`,
    )
    .join("");

  const hasHerrajes = body.length > 0;
  const head = conUbicacion
    ? `<span>Herraje</span><span>Medida / color</span><span>Prov.</span><span>Ubicación</span><span class="rt">Cant.</span>`
    : `<span>Herraje</span><span>Medida / color</span><span>Prov.</span><span class="rt">Cant.</span>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Herrajes mueblista — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600;700&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  <div class="page">
    <div class="wm">${iso ? `<img src="${iso}" alt="" />` : ""}</div>
    <div class="pad-detail">
      ${iso ? `<img class="dhead-iso" src="${iso}" alt="" />` : ""}
      <div class="dhead">
        <div>
          <div class="kick">Listado de herrajes · mueblista</div>
          <div class="proj">${esc(project.name)}</div>
          ${psub ? `<div class="psub">${esc(psub)}</div>` : ""}
        </div>
        <div class="right">
          <div class="ver">${esc(versionLarga)}</div>
          <div class="doc">${esc(budget.version)} Herrajes</div>
          <div class="docsub">Mueblista</div>
        </div>
      </div>
      ${
        hasHerrajes
          ? `<div class="${conUbicacion ? "t5" : "t4"}"><div class="mhd">${head}</div>${body}</div>`
          : `<div class="empty">Esta cotización no tiene herrajes cargados.</div>`
      }
    </div>
  </div>
</body>
</html>`;
}
