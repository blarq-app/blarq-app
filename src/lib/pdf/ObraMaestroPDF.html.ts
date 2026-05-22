/**
 * PDF "Cotizacion Maestro": variante del Obra PDF para entregarle al
 * maestro que va a ejecutar la obra. Mismas partidas y cantidades que la
 * cotizacion al cliente, pero columnas P.U. y TOTAL vacias — el maestro
 * las completa con su propio precio.
 *
 * Sin totales, sin formas de pago, sin observaciones del cliente. Solo
 * el alcance de la obra para que el maestro cotice.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "DEMOLICIONES", index: 1 },
  reparaciones: { label: "REPARACIONES", index: 2 },
  electricas: { label: "INSTALACIONES ELECTRICAS", index: 3 },
  sanitarias: { label: "INSTALACIONES SANITARIAS Y GASFITERIA", index: 4 },
  terminaciones: { label: "TERMINACIONES", index: 5 },
  limpieza: { label: "ASEO Y LIMPIEZA", index: 6 },
};

export interface ObraMaestroItemInput {
  chapter: string;
  // Sub-chapter opcional (ej. "COCINA", "BANO") para agrupar partidas
  // dentro del capitulo. Si esta presente, se renderiza una fila
  // separadora antes del primer item con ese subChapter. No hay
  // subtotales por zona porque el maestro no tiene precios.
  subChapter: string | null;
  name: string;
  // Para el maestro mostramos la descriptionMaestro (instrucciones de
  // ejecucion) cuando existe. Si no, cae a descriptionCliente.
  descriptionMaestro: string | null;
  descriptionCliente: string | null;
  unit: string;
  quantity: number;
}

export interface ObraMaestroHTMLInput {
  project: {
    name: string;
    clientName: string;
    address: string | null;
  };
  budget: {
    version: string;
    date: string | Date;
  };
  maestro: { name: string | null } | null;
  items: ObraMaestroItemInput[];
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

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function getLogoDataUri(): string {
  const logoPath = path.join(
    process.cwd(),
    "public",
    "assets",
    "logo-blarq.png"
  );
  try {
    const bytes = fs.readFileSync(logoPath);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// CSS calcado del ObraPDF.html.ts (mismo lenguaje visual BLARQ). Cambios:
//   - sin .totals (no van), sin .payment, sin .obs
//   - columnas P.U./TOTAL quedan vacias en cuerpo, headers iguales
//   - tamano base un pelin mas grande (5.8pt) porque hay menos contenido
//     y el maestro lo va a leer en obra, no en escritorio.
const CSS = `
  @page { size: A4; margin: 12mm 12mm 12mm 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Montserrat', Calibri, Arial, sans-serif;
    font-size: 5.8pt; font-weight: 400; color: #000;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    margin-bottom: 6px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo { display: block; height: 36px; width: auto; margin-bottom: 1px; }

  .doc-block { margin-bottom: 4px; line-height: 1; }
  .doc-version-label { font-size: 5.5pt; color: #404040; font-weight: 400; line-height: 1.1; }
  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 14pt; font-weight: 500; color: #808080;
    line-height: 1; margin: 1px 0 0 0; letter-spacing: 0.01em;
  }
  .doc-subtitle {
    font-size: 7pt; font-weight: 500; color: #808080;
    letter-spacing: 0.05em; margin: 1px 0 0 0; text-transform: uppercase;
  }

  .field { margin-bottom: 2px; line-height: 1.1; }
  .field .label { font-size: 5.5pt; font-weight: 400; color: #404040; }
  .field .value { font-size: 6pt; font-weight: 700; color: #000; text-transform: uppercase; }

  table.partidas {
    width: 100%; border-collapse: collapse; table-layout: fixed;
    font-size: 5.6pt; margin-top: 4px;
  }
  .partidas th, .partidas td {
    padding: 1.5px 3px; vertical-align: middle;
    border: none; border-bottom: 0.4pt solid #000;
    word-wrap: break-word; line-height: 1.15;
  }
  .partidas thead th {
    background: #DBDBDB; color: #000; font-weight: 700;
    text-transform: uppercase; padding: 3px 3px;
    font-size: 5.8pt; text-align: center; line-height: 1;
    border-top: 0.4pt solid #000; border-bottom: 0.4pt solid #000;
  }
  .partidas tr.chapter-row td {
    background: #DBDBDB; font-weight: 700; text-transform: uppercase;
    padding: 2px 3px; font-size: 5.8pt;
    border-bottom: 0.4pt solid #000;
  }
  .partidas tr.chapter-row td.chapter-idx { text-align: center; }

  /* Fila separadora de sub-chapter (ej. "COCINA", "BANO"). Gris mas
     claro que el chapter, italic, sin bordes — separador visual sutil. */
  .partidas tr.sub-chapter-row td {
    background: #F2F2F2;
    font-weight: 600;
    font-style: italic;
    text-transform: uppercase;
    padding: 2px 6px;
    font-size: 5.8pt;
    border-bottom: 0.4pt solid #999;
    letter-spacing: 0.02em;
  }

  /* P.U. y TOTAL en blanco — ancho proporcional para que el maestro
     escriba a mano si imprime. */
  .col-item   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-name   { width: 19%; text-align: left;   font-weight: 600; }
  .col-desc   { width: 40%; text-align: left;   font-weight: 400; }
  .col-unit   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-qty    { width: 8%;  text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-pu     { width: 10%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-total  { width: 13%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }

  tr { page-break-inside: avoid; }

  /* Nota al pie: este PDF no incluye precios — el maestro los completa. */
  .footer-note {
    margin-top: 14px;
    font-size: 6pt;
    color: #404040;
    line-height: 1.35;
    padding-top: 4px;
    border-top: 0.4pt solid #CCC;
  }
`;

export function renderObraMaestroHTML(data: ObraMaestroHTMLInput): string {
  const { project, budget, maestro, items } = data;

  // Ordenar items dentro del chapter por subChapter (los sin sub-chapter
  // primero, despues agrupados alfabeticamente), despues por nombre. Espejo
  // del orden del editor y del PDF de obra al cliente.
  const sortItemsBySubChapter = (
    a: ObraMaestroItemInput,
    b: ObraMaestroItemInput
  ) => {
    const aSub = a.subChapter ?? "";
    const bSub = b.subChapter ?? "";
    if (aSub !== bSub) return aSub.localeCompare(bSub, "es");
    return a.name.localeCompare(b.name, "es");
  };

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: items.filter((i) => i.chapter === key).sort(sortItemsBySubChapter),
    }))
    .filter((ch) => ch.items.length > 0);

  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:44px;font-size:24pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = chapters
    .map(
      (ch) => `
        <tr class="chapter-row">
          <td class="col-item chapter-idx">${ch.index}</td>
          <td class="col-name">${esc(ch.label)}</td>
          <td class="col-desc"></td>
          <td class="col-unit"></td>
          <td class="col-qty"></td>
          <td class="col-pu"></td>
          <td class="col-total"></td>
        </tr>
        ${ch.items
          .map((item, idx) => {
            // Si cambia el subChapter respecto al item anterior, anteponemos
            // una fila separadora gris clara con el nombre del sub-chapter.
            const prev = idx > 0 ? ch.items[idx - 1] : null;
            const showSub =
              item.subChapter && (!prev || prev.subChapter !== item.subChapter);
            return `
          ${
            showSub
              ? `<tr class="sub-chapter-row">
                  <td colspan="7">${esc(item.subChapter!)}</td>
                </tr>`
              : ""
          }
          <tr>
            <td class="col-item">${ch.index}.${idx + 1}</td>
            <td class="col-name">${esc(item.name)}</td>
            <td class="col-desc">${esc(
              item.descriptionMaestro ?? item.descriptionCliente ?? ""
            )}</td>
            <td class="col-unit">${esc(item.unit)}</td>
            <td class="col-qty">${fmtQty(item.quantity)}</td>
            <td class="col-pu"></td>
            <td class="col-total"></td>
          </tr>`;
          })
          .join("")}
      `
    )
    .join("");

  const addressStr = project.address ? esc(project.address) : "POR CONFIRMAR";
  const maestroStr = maestro?.name ? esc(maestro.name) : "—";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACION MAESTRO — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div class="field">
        <div class="label">Mandante</div>
        <div class="value">${esc(project.clientName)}</div>
      </div>
      <div class="field">
        <div class="label">Proyecto</div>
        <div class="value">${esc(project.name)}</div>
      </div>
      <div class="field">
        <div class="label">Direccion</div>
        <div class="value">${addressStr}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-block">
        <div class="doc-version-label">Version:</div>
        <div class="doc-title">${esc(budget.version)} COTIZACION</div>
        <div class="doc-subtitle">MAESTRO — OBRA</div>
      </div>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      <div class="field">
        <div class="label">Maestro</div>
        <div class="value">${maestroStr}</div>
      </div>
      <div class="field">
        <div class="label">Fecha</div>
        <div class="value">${dateStr}</div>
      </div>
    </div>
  </div>

  <table class="partidas">
    <thead>
      <tr>
        <th class="col-item">ITEM</th>
        <th class="col-name">PARTIDA</th>
        <th class="col-desc">DESCRIPCION</th>
        <th class="col-unit">UNIDAD</th>
        <th class="col-qty">CANT.</th>
        <th class="col-pu">P.U.</th>
        <th class="col-total">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer-note">
    Este documento es el alcance de la obra para cotizacion del maestro.
    Las columnas P.U. y TOTAL quedan en blanco para que el maestro las complete con sus precios.
  </div>

</body>
</html>`;
}

export function buildObraMaestroFooter(version: string, date: string | Date): string {
  const dateStr = fmtDate(date);
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      color: #808080;
      width: 100%;
      padding: 4px 12mm 0;
      margin: 0;
      border-top: 0.4pt solid #CCC;
      display: flex;
      justify-content: space-between;
    ">
      <span>blarq.cl · cotizacion maestro</span>
      <span>${esc(version)} — ${dateStr}</span>
    </div>
  `;
}
