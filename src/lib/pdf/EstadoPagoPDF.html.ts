/**
 * HTML+CSS renderer for the Estado de Pago (Maestro) PDF.
 * Consumed by renderPDF() (Puppeteer). Replica el formato editorial
 * de la referencia Portofino con el lenguaje visual BLARQ.
 */

import fs from "node:fs";
import path from "node:path";
import { sanitizeRichTextHtml } from "@/lib/richText";
import { groupEpItemsByChapter } from "@/lib/presupuesto/chapters";
import { annotateZones } from "@/lib/presupuesto/zones";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

// ─── Types ────────────────────────────────────────────────────────────────
export interface EPItemInput {
  // Foto del capítulo que guarda la partida del EP. Ver groupEpItemsByChapter.
  chapterName: string | null;
  chapterOrder: number;
  subChapter?: string | null;
  // Orden manual (el que arma MJ arrastrando en el editor de la cotización).
  // El EP respeta ESTE orden para que salga igual que la pantalla.
  sortOrder: number;
  itemNumber: string;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  pctAccumulated: number; // 0..100
  pctPrev: number; // 0..100 — % que ya venía pagado de EPs cerrados anteriores
  prevAmountPaid: number; // $ ya pagado al maestro por esta partida antes de este EP
  amountThisEp: number; // delta este EP (newQty × pu)
  totalAccumulated: number; // acumulado total = prevAmountPaid + amountThisEp (lo que va en columna "$ A PAGAR" del PDF)
  outOfScope: boolean;
}

export interface PreviousEPInput {
  number: number;
  date: string | Date;
  totalPaid: number;
}

export interface EPHTMLInput {
  project: {
    name: string;
    clientName: string;
    clientPhone: string | null;
    address: string | null;
    ufReference: number | null;
    maestro: { name: string; rut: string | null } | null;
  };
  ep: {
    number: number;
    date: string | Date;
    notes: string | null;
    budgetVersion: string | null; // ej: "V4"
  };
  items: EPItemInput[];
  previousEps: PreviousEPInput[];
  totalLaborBudget: number; // total MO presupuestado en la versión vigente
  totalAmountThisEp: number; // total a pagar este EP
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCLP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/**
 * Celda de avance de una partida: barra en DOS TRAMOS + leyenda de cada parte.
 *
 * El tramo oscuro es lo que el maestro YA cobró en EPs cerrados anteriores; el
 * claro es lo que agrega este EP. Hasta acá la barra pintaba un solo tramo con
 * el acumulado, así que el maestro veía "66%" sin saber cuánto de eso ya le
 * habían pagado.
 *
 * La leyenda omite la parte que no aplica: en el EP 1 no hay previo (un solo
 * tramo, una sola línea) y una partida fuera de alcance tiene previo pero no
 * suma nada nuevo.
 */
function avanceCelda(item: EPItemInput): string {
  const prev = clampPct(item.pctPrev);
  const total = clampPct(item.pctAccumulated);
  const nuevo = Math.max(0, total - prev);
  const leyenda = [
    prev > 0
      ? `<div><span class="marca" style="background:#8A7F6F"></span>ya pagado ${prev.toFixed(0)}% · ${fmtCLP(item.prevAmountPaid)}</div>`
      : "",
    nuevo > 0
      ? `<div><span class="marca" style="background:#CFCBC5"></span>este EP ${nuevo.toFixed(0)}% · ${fmtCLP(item.amountThisEp)}</div>`
      : "",
  ].join("");
  return `
              <div class="avance-cell">
                <div class="avance-bar">
                  <div class="avance-fill avance-fill-prev" style="width: ${prev.toFixed(1)}%"></div>
                  <div class="avance-fill avance-fill-nuevo" style="width: ${nuevo.toFixed(1)}%"></div>
                </div>
                <span class="avance-pct">${total.toFixed(0)}%</span>
              </div>
              ${leyenda ? `<div class="avance-leyenda">${leyenda}</div>` : ""}`;
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function getLogoDataUri(): string {
  const logoPath = path.join(process.cwd(), "public", "assets", "logo-blarq.png");
  try {
    const bytes = fs.readFileSync(logoPath);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  @page { size: A4 landscape; margin: 12mm 12mm 16mm 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 7pt;
    color: #000;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .header { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }
  .logo { display: block; height: 44px; width: auto; margin-bottom: 6px; }

  .doc-version { font-size: 7pt; color: #808080; letter-spacing: 0.06em; text-transform: uppercase; }
  .doc-title { font-size: 14pt; font-weight: 500; color: #808080; margin: 0 0 6px 0; }

  .field { margin-bottom: 3px; }
  .field .label { font-size: 6pt; font-weight: 400; color: #808080; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.2; }
  .field .value { font-size: 7.5pt; font-weight: 500; color: #000; line-height: 1.2; }

  /* ── Section title block ────────────────────────────────────── */
  .section-block {
    display: flex; justify-content: flex-end; align-items: center;
    margin: 16px 0 0 0;
  }
  .section-title {
    font-size: 8pt; font-weight: 700; color: #000;
    letter-spacing: 0.05em; text-transform: uppercase;
    background: #FFF;
    padding: 4px 10px;
    border-top: 0.75pt solid #000; border-bottom: 0.75pt solid #000;
    width: 35%; text-align: center;
  }

  /* ── Table ──────────────────────────────────────────────────── */
  table.partidas {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 7pt;
    margin-top: 4px;
  }
  .partidas th, .partidas td {
    padding: 0.8px 4px;
    vertical-align: top;
    border: none;
    border-bottom: 0.5pt solid #CCCCCC;
    word-wrap: break-word;
    line-height: 1.08;
  }
  .partidas thead th {
    background: #FFFFFF;
    color: #000;
    font-weight: 700;
    text-transform: uppercase;
    border-top: 0.75pt solid #000;
    border-bottom: 0.75pt solid #000;
    padding: 4px 4px;
    font-size: 7pt;
  }
  .partidas tr.chapter-row td {
    background: #DBDBDB;
    font-weight: 700;
    text-transform: uppercase;
    padding-top: 1.5px;
    padding-bottom: 1.5px;
  }
  .partidas tr.sub-chapter-row td {
    background: #F2F2F2;
    font-weight: 600;
    font-style: italic;
    text-transform: uppercase;
    color: #404040;
    padding: 2px 4px;
    letter-spacing: 0.02em;
  }
  .partidas tbody tr:first-child td { padding-top: 4px; }
  .partidas tr.chapter-row td.chapter-idx { text-align: center; }

  /* Column widths (sum 100%) */
  .col-item   { width: 4%;  text-align: center; white-space: nowrap; }
  .col-name   { width: 18%; text-align: left; text-transform: uppercase; }
  .col-desc   { width: 28%; text-align: left; font-size: 6pt; color: #555; }
  /* Descripción con formato (negrita/cursiva/listas/color del editor). */
  .col-desc p  { margin: 0; }
  .col-desc ul { margin: 0; padding-left: 12px; list-style: disc; }
  .col-desc ol { margin: 0; padding-left: 14px; list-style: decimal; }
  .col-desc li { margin: 0; }
  .col-desc strong { font-weight: 700; }
  .col-desc em { font-style: italic; }
  .col-unit   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-qty    { width: 6%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-pu     { width: 9%;  text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-total  { width: 10%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-avance { width: 14%; text-align: center; }
  .col-pagar  { width: 10%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 500; }

  thead .col-desc { font-size: 7pt; color: #000; }

  thead th.col-item   { text-align: center; }
  thead th.col-name   { text-align: left; }
  thead th.col-desc   { text-align: left; }
  thead th.col-unit   { text-align: center; }
  thead th.col-qty    { text-align: center; }
  thead th.col-pu     { text-align: right; }
  thead th.col-total  { text-align: right; }
  thead th.col-avance { text-align: center; }
  thead th.col-pagar  { text-align: right; }

  /* Avance bar */
  .avance-cell {
    display: flex; align-items: center; gap: 4px;
    justify-content: center;
  }
  .avance-bar {
    flex: 1;
    height: 8px;
    background: #EEEDEC;
    border-radius: 1px;
    overflow: hidden;
    position: relative;
    display: flex;
  }
  /* La barra va en DOS TRAMOS: el oscuro es lo que ya se le pagó al maestro en
     EPs cerrados anteriores, el claro es lo que agrega ESTE EP. Antes pintaba
     un solo tramo y el maestro no podía ver de dónde venía el acumulado. */
  /* Greige de la marca (globals.css), no el naranja que había antes ni un
     negro duro: Piedra para lo ya pagado y Greige para lo de este EP. Son los
     MISMOS dos tonos que usa la barra de la pantalla, para que el PDF que
     recibe el maestro y lo que ve MJ no se lean distinto. */
  .avance-fill { height: 100%; }
  .avance-fill-prev  { background: #8A7F6F; }
  .avance-fill-nuevo { background: #CFCBC5; }
  .avance-pct {
    font-size: 6.5pt;
    font-variant-numeric: tabular-nums;
    color: #000;
    white-space: nowrap;
    min-width: 28px;
    text-align: right;
  }
  /* Leyenda debajo de la barra. Dos líneas cortas: no entra en una sola con el
     ancho de la columna. Se omite la que no aplica (en el EP 1 no hay previo). */
  .avance-leyenda {
    margin-top: 2px;
    font-size: 5.5pt;
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
    color: #555;
    white-space: nowrap;
    text-align: center;
  }
  .avance-leyenda .marca {
    display: inline-block;
    width: 4px; height: 4px;
    border-radius: 1px;
    margin-right: 2px;
    vertical-align: middle;
  }

  /* Out of scope row — sutil ámbar */
  tr.out-of-scope td { background: #FFF7E6; }
  .badge-oos {
    display: inline-block;
    font-size: 5.5pt;
    background: #FCE7B6;
    color: #92400E;
    padding: 1px 4px;
    border-radius: 2px;
    margin-left: 4px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
  }

  /* ── Totals row at end of table ──────────────────────────────── */
  tr.total-row td {
    border-top: 0.75pt solid #000;
    border-bottom: 0.75pt solid #000;
    background: #FFFFFF;
    padding: 5px 4px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 7.5pt;
  }
  tr.total-row .col-pu, tr.total-row .col-total, tr.total-row .col-pagar {
    font-weight: 700;
  }
  /* La fila de lo que se paga AHORA: es el número que el maestro va a cobrar,
     así que va más marcada que el acumulado de arriba. */
  tr.pagar-row td {
    border-bottom: 0.75pt solid #000;
    background: #F2F2F2;
    padding: 5px 4px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 8pt;
  }

  /* ── Histórico EPs ───────────────────────────────────────────── */
  .historico-wrap { margin-top: 14px; }
  .historico-title {
    font-size: 7pt; font-weight: 400; color: #808080;
    letter-spacing: 0.06em; text-transform: uppercase;
    border-bottom: 0.5pt solid #CCCCCC;
    padding-bottom: 3px; margin: 0 0 6px 0;
  }
  table.historico {
    width: 50%;
    margin-left: auto;
    border-collapse: collapse;
    font-size: 7pt;
  }
  .historico td {
    padding: 2px 4px;
    border-bottom: 0.5pt solid #EEE;
    font-variant-numeric: tabular-nums;
  }
  .historico .h-num { width: 30%; color: #555; }
  .historico .h-date { width: 30%; color: #808080; }
  .historico .h-amount { text-align: right; color: #000; }
  .historico tr.h-total td {
    border-top: 0.5pt solid #000;
    border-bottom: 0.5pt solid #000;
    font-weight: 700;
    padding-top: 4px;
    padding-bottom: 4px;
  }

  /* ── Firmas ──────────────────────────────────────────────────── */
  .signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 60px;
    margin-top: 18px;
    page-break-before: avoid;
    page-break-inside: avoid;
  }
  .signature-block {
    border-top: 0.5pt solid #999;
    padding-top: 4px;
    text-align: center;
  }
  .signature-label {
    font-size: 7pt;
    color: #808080;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  tr { page-break-inside: avoid; }
`;

// ─── Renderer ─────────────────────────────────────────────────────────────
export function renderEPHtml(data: EPHTMLInput): string {
  const { project, ep, items, previousEps, totalLaborBudget, totalAmountThisEp } = data;

  // Capítulos en el MISMO orden y numeración que el editor (helper compartido,
  // con reflow saltando vacíos). El EP agrupa por la FOTO del capítulo que
  // guarda cada partida (chapterName + chapterOrder), no por el presupuesto
  // vivo: una partida fuera de alcance puede apuntar a un capítulo que ya no
  // existe. Las partidas en orden de sortOrder (el orden manual de MJ), NO
  // alfabético — para que el EP salga igual que la cotización en pantalla.
  const chapterEntries = groupEpItemsByChapter(items).map((g) => ({
    key: g.chapter.id,
    label: g.chapter.name,
    items: g.items,
    index: g.index ?? 0,
  }));

  const totalAccumulatedPrior = previousEps.reduce((s, p) => s + p.totalPaid, 0);
  // Total de la columna "$ ACUMULADO": la suma de lo que muestran las filas.
  // Sin esto la columna no cerraba con su propio pie (ver la nota de las dos
  // filas de totales más abajo).
  const totalAccumulatedAllItems = items.reduce(
    (s, i) => s + i.totalAccumulated,
    0
  );

  const logoUri = getLogoDataUri();
  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:60px;font-size:28pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = chapterEntries
    .map(
      (ch) => {
      // Zona DERIVADA por posición (mismo helper que la cotización): una partida
      // sin zona propia hereda la de arriba. El encabezado de zona va en la
      // primera partida de cada zona. (annotateZones pide `total`; el EP no
      // muestra subtotal por zona, así que pasamos el total de MO solo para
      // cumplir el tipo.)
      const { rows } = annotateZones(
        ch.items.map((i) => ({ ...i, total: i.quantity * i.laborUnitPrice }))
      );
      return `
        <tr class="chapter-row">
          <td class="col-item">${ch.index}</td>
          <td class="col-name" colspan="8">${esc(ch.label)}</td>
        </tr>
        ${rows
          .map(
            (row, idx) => {
            const item = row.item;
            return `
          ${
            row.isZoneStart
              ? `<tr class="sub-chapter-row"><td></td><td colspan="8">${esc(row.zone!)}</td></tr>`
              : ""
          }
          <tr${item.outOfScope ? ' class="out-of-scope"' : ""}>
            <td class="col-item">${ch.index}.${idx + 1}</td>
            <td class="col-name">
              ${esc(item.name)}
              ${item.outOfScope ? '<span class="badge-oos">Fuera de alcance</span>' : ""}
            </td>
            <td class="col-desc">${sanitizeRichTextHtml(item.descriptionMaestro)}</td>
            <td class="col-unit">${esc(item.unit)}</td>
            <td class="col-qty">${fmtQty(item.quantity)}</td>
            <td class="col-pu">${fmtCLP(item.laborUnitPrice)}</td>
            <td class="col-total">${fmtCLP(item.quantity * item.laborUnitPrice)}</td>
            <td class="col-avance">${avanceCelda(item)}</td>
            <td class="col-pagar">${item.totalAccumulated > 0 ? fmtCLP(item.totalAccumulated) : "—"}</td>
          </tr>`;
          }
          )
          .join("")}
      `;
    }
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>EP #${ep.number} — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <!-- HEADER -->
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
        <div class="label">Dirección</div>
        <div class="value">${esc(project.address || "—")}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-version">Versión:</div>
      <h1 class="doc-title">${esc(ep.budgetVersion ?? "")} OBRA — EP #${ep.number}</h1>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      <div class="field">
        <div class="label">Maestro</div>
        <div class="value">${esc(project.maestro?.name || "—")}</div>
      </div>
      <div class="field">
        <div class="label">Fecha</div>
        <div class="value">${fmtDate(ep.date)}</div>
      </div>
      ${
        project.clientPhone
          ? `<div class="field"><div class="label">Celular Mandante</div><div class="value">${esc(project.clientPhone)}</div></div>`
          : ""
      }
      ${
        project.ufReference != null
          ? `<div class="field"><div class="label">Valor UF</div><div class="value">${fmtCLP(project.ufReference)}</div></div>`
          : ""
      }
    </div>
  </div>

  <!-- Section title -->
  <div class="section-block">
    <div class="section-title">MANO DE OBRA</div>
  </div>

  <!-- TABLE -->
  <table class="partidas">
    <thead>
      <tr>
        <th class="col-item">ITEM</th>
        <th class="col-name">PARTIDA</th>
        <th class="col-desc">DESCRIPCION</th>
        <th class="col-unit">UNIDAD</th>
        <th class="col-qty">CANT.</th>
        <th class="col-pu">P.U</th>
        <th class="col-total">TOTAL</th>
        <th class="col-avance">AVANCE</th>
        <th class="col-pagar">$ ACUMULADO</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      <!-- Dos filas, no una. Antes había UNA sola que ponía el monto de ESTE EP
           al pie de una columna cuyas filas traen el ACUMULADO: la columna no
           sumaba su propio total y quedaba a mano leer el acumulado como si
           fuera lo que hay que pagar (en el EP 2 de Paseo del Sena eran
           $3.993.242 contra $3.077.400 reales). Ahora cada total corresponde a
           su columna, y lo que se paga va en su propia fila, rotulado. -->
      <tr class="total-row">
        <td class="col-item"></td>
        <td class="col-name" colspan="5">TOTAL MANO DE OBRA</td>
        <td class="col-total">${fmtCLP(totalLaborBudget)}</td>
        <td class="col-avance"></td>
        <td class="col-pagar">${fmtCLP(totalAccumulatedAllItems)}</td>
      </tr>
      <tr class="pagar-row">
        <td class="col-item"></td>
        <td class="col-name" colspan="5">A PAGAR ESTE ESTADO DE PAGO</td>
        <td class="col-total"></td>
        <td class="col-avance"></td>
        <td class="col-pagar">${fmtCLP(totalAmountThisEp)}</td>
      </tr>
    </tbody>
  </table>

  ${
    previousEps.length > 0
      ? `
  <!-- Histórico EPs anteriores -->
  <div class="historico-wrap">
    <div class="historico-title">Estados de pago anteriores</div>
    <table class="historico">
      <tbody>
        ${previousEps
          .map(
            (p) => `
        <tr>
          <td class="h-num">Estado de Pago ${p.number}</td>
          <td class="h-date">${fmtDate(p.date)}</td>
          <td class="h-amount">${fmtCLP(p.totalPaid)}</td>
        </tr>`
          )
          .join("")}
        <tr class="h-total">
          <td class="h-num">Acumulado pagado</td>
          <td class="h-date"></td>
          <td class="h-amount">${fmtCLP(totalAccumulatedPrior)}</td>
        </tr>
        <tr class="h-total">
          <td class="h-num">Este EP</td>
          <td class="h-date"></td>
          <td class="h-amount">${fmtCLP(totalAmountThisEp)}</td>
        </tr>
      </tbody>
    </table>
  </div>
  `
      : ""
  }

  ${
    ep.notes
      ? `
  <div style="margin-top:16px; font-size:7pt; color:#555; line-height:1.4;">
    <span style="color:#808080; text-transform:uppercase; letter-spacing:0.05em; font-size:6.5pt;">Notas:</span>
    ${esc(ep.notes)}
  </div>
  `
      : ""
  }


</body>
</html>`;
}

/**
 * Footer template para Puppeteer.
 */
export function buildEPFooter(epNumber: number, date: string | Date): string {
  const dateStr = fmtDate(date);
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      font-weight: 400;
      color: #808080;
      width: 100%;
      padding: 4px 12mm 0;
      margin: 0;
      border-top: 0.5pt solid #CCC;
      display: flex;
      justify-content: space-between;
    ">
      <span>blarq.cl</span>
      <span>EP #${epNumber} — ${dateStr}</span>
    </div>
  `;
}
