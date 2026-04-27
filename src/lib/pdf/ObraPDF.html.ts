/**
 * HTML+CSS renderer for the Obra budget PDF.
 * Consumed by renderPDF() (Puppeteer). Meant to render as an exact
 * visual match to the Excel reference PDF.
 *
 * Iteration 5 — full Montserrat, specs pulled directly from Excel XML.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 40 },
  { stage: "Avance", percentage: 25 },
  { stage: "Avance", percentage: 25 },
  { stage: "Saldo", percentage: 10 },
];

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "DEMOLICIONES", index: 1 },
  reparaciones: { label: "REPARACIONES", index: 2 },
  electricas: { label: "INSTALACIONES ELECTRICAS", index: 3 },
  sanitarias: { label: "INSTALACIONES SANITARIAS Y GASFITERIA", index: 4 },
  terminaciones: { label: "TERMINACIONES", index: 5 },
  limpieza: { label: "LIMPIEZA Y ASEO", index: 6 },
};

const OBSERVACIONES = [
  "Mandante dejara libre los accesos y las superficies a intervenir, dispondra de suministro electrico y de agua potable, ademas de baño para las personas que trabajen en la obra.",
  "Todo aumento de obra se recargara al costo directo según los precios unitarios más un recargo del mismo porcentaje en GG expresado en la oferta.",
  "No se consideran Permisos Municipales ni de administacion del Condominio dentro de este presupuesto.",
  "Esta cotizacion tiene una validez de 10 dias corridos.",
  "Los pagos se haran con el valor de la UF del dia, y solo se aceptaran pagos por transferencia bancaria o con tarjeta por medio de link de pago, en cuyo caso se agregara la comision de Transbank.",
  "Los valores expresados en la cotizacion podrian variar luego de visitar la propiedad.",
  "Al aprobar la cotizacion se autoriza a la empresa Blarq a publicar contenido en Redes Sociales y pagina web. Fotos, videos del avance y estado de la obra y a la instalacion de publicidad hacia el exterior de la obra (terrazas, balcones, porton).",
  "Una vez aprobado el presupuesto, se solicita pago de anticipo al menos 2 semanas antes del comienzo de la obra.",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface ObraItemInput {
  chapter: string;
  itemNumber: string;
  name: string;
  descriptionCliente: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PaymentTermInput {
  stage: string;
  percentage: number;
}

export interface ObraHTMLInput {
  project: {
    name: string;
    clientName: string;
    clientPhone: string | null;
    clientEmail: string | null;
    address: string | null;
    ufReference: number | null;
  };
  budget: {
    version: string;
    date: string | Date;
    ggPercentage: number | null;
    utilityPercentage: number | null;
  };
  items: ObraItemInput[];
  paymentTerms: PaymentTermInput[];
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
  // Chilean comma decimals: 15,4
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

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  @page { size: A4; margin: 12mm 14mm 16mm 14mm; }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 10pt;
    font-weight: 400;
    color: #000;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 40px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo {
    display: block;
    height: 44px;
    width: auto;
    margin-bottom: 6px;
  }

  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 14pt;
    font-weight: 500;
    color: #808080;
    line-height: 1;
    margin: 0 0 6px 0;
    letter-spacing: 0;
  }

  .field { margin-bottom: 3px; }
  .field .label {
    font-size: 6pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 0;
    line-height: 1.2;
  }
  .field .value {
    font-size: 7.5pt;
    font-weight: 500;
    color: #000;
    line-height: 1.2;
  }

  .header-divider {
    border: none;
    border-top: 1px solid #ddd;
    margin: 4px 0;
  }

  /* ── Table ──────────────────────────────────────────────────── */
  /* NOTE: spec asks 10pt but 51 items + 6 chapters does not fit in 2 pages
   * at that size. Dropped to 8.5pt / tighter padding to match the Excel's
   * page count. */
  table.partidas {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 7pt;
    margin-top: 20px;
  }
  .partidas th, .partidas td {
    padding: 1.5px 4px;
    vertical-align: top;
    border: none;
    border-bottom: 0.5pt solid #CCCCCC;
    word-wrap: break-word;
    line-height: 1.15;
  }
  .partidas thead th {
    background: #FFFFFF;
    color: #000;
    font-weight: 700;
    text-transform: uppercase;
    border-top: 1.5pt solid #000;
    border-bottom: 1.5pt solid #000;
    padding: 4px 4px;
    font-size: 7.5pt;
  }
  .partidas tr.chapter-row td {
    background: #DBDBDB;
    font-weight: 700;
    text-transform: uppercase;
    border-top: none;
    border-bottom: 0.5pt solid #CCCCCC;
    padding-top: 2.5px;
    padding-bottom: 2.5px;
  }
  /* Extra breathing room between thead and first chapter row */
  .partidas tbody tr:first-child td { padding-top: 7px; }
  .partidas tr.chapter-row td.chapter-idx { text-align: center; }

  /* Column widths (must sum to 100%) */
  .col-item   { width: 4%;  text-align: center; white-space: nowrap; }
  .col-name   { width: 24%; text-align: left; }
  .col-desc   { width: 39%; text-align: left; font-size: 6pt; }
  .col-unit   { width: 6%;  text-align: center; white-space: nowrap; }
  .col-qty    { width: 7%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-pu     { width: 9%;  text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-total  { width: 11%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* thead DESCRIPCION slightly larger than body (6pt) but not jarring */
  thead .col-desc { font-size: 7pt; }
  /* Explicit alignments for THs (inherit width from first cell) */
  thead th.col-item { text-align: center; }
  thead th.col-name { text-align: left; }
  thead th.col-desc { text-align: left; }
  thead th.col-unit { text-align: center; }
  thead th.col-qty  { text-align: center; }
  thead th.col-pu   { text-align: right; }
  thead th.col-total{ text-align: right; }

  /* ── Totals ─────────────────────────────────────────────────── */
  .totals-wrap {
    width: 100%;
    margin-top: 16px;
  }
  table.totals {
    width: 100%;
    border-collapse: collapse;
    font-size: 7pt;
  }
  .totals td {
    padding: 2.5px 10px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    border: none;
    color: #000;
  }
  .totals .t-label { width: 100%; text-align: left; text-transform: uppercase; font-weight: 400; white-space: nowrap; }
  .totals .t-pct   { text-align: right; white-space: nowrap; padding-left: 20px; padding-right: 18px; }
  .totals .t-cur   { text-align: left; white-space: nowrap; padding-left: 0; padding-right: 14px; }
  .totals .t-val   { text-align: right; white-space: nowrap; padding-left: 0; padding-right: 4px; }
  .totals tr.total td {
    border-top: 0.5pt solid #000;
    font-weight: 700;
  }

  /* ── Section titles (unified) ───────────────────────────────── */
  .section-title {
    font-size: 7pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-bottom: 0.5pt solid #CCCCCC;
    padding-bottom: 3px;
    margin: 0 0 8px 0;
  }

  /* ── Payment terms ──────────────────────────────────────────── */
  .payment-wrap { margin-top: 24px; }
  table.payment { border-collapse: collapse; white-space: nowrap; border: none; }
  .payment td {
    padding: 1px 0;
    font-size: 6.5pt;
    font-weight: 400;
    border: none;
    color: #000;
  }
  .payment .p-stage { width: 80px; padding-right: 10px; }
  .payment .p-pct   { color: #808080; }

  /* ── Observations ───────────────────────────────────────────── */
  .obs-wrap  { margin-top: 32px; }
  .obs-grid  { column-count: 1; }
  .obs-item {
    display: flex;
    font-size: 7pt;
    font-weight: 400;
    color: #808080;
    line-height: 1.4;
    margin-bottom: 3px;
    text-align: left;
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    page-break-inside: avoid;
  }
  .obs-num  { width: 14px; flex-shrink: 0; font-weight: 500; color: #808080; }
  .obs-text { flex: 1; }

  /* Avoid splitting a row across pages */
  tr { page-break-inside: avoid; }
`;

// ─── Renderer ─────────────────────────────────────────────────────────────
export function renderObraHTML(data: ObraHTMLInput): string {
  const { project, budget, items, paymentTerms } = data;
  const ggPct = budget.ggPercentage ?? 0;
  const utilPct = budget.utilityPercentage ?? 0;

  // Integer math with Math.round at each total line (spec §6).
  const costoDirecto = Math.round(items.reduce((s, i) => s + i.total, 0));
  const gg = Math.round(costoDirecto * (ggPct / 100));
  const utilidad = Math.round(costoDirecto * (utilPct / 100));
  const neto = costoDirecto + gg + utilidad;
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: items.filter((i) => i.chapter === key),
    }))
    .filter((ch) => ch.items.length > 0);

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:60px;font-size:28pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = chapters
    .map(
      (ch) => `
        <tr class="chapter-row">
          <td class="col-item">${ch.index}</td>
          <td class="col-name">${esc(ch.label)}</td>
          <td class="col-desc"></td>
          <td class="col-unit"></td>
          <td class="col-qty"></td>
          <td class="col-pu"></td>
          <td class="col-total"></td>
        </tr>
        ${ch.items
          .map(
            (item) => `
          <tr>
            <td class="col-item">${esc(item.itemNumber)}</td>
            <td class="col-name">${esc(item.name)}</td>
            <td class="col-desc">${esc(item.descriptionCliente ?? "")}</td>
            <td class="col-unit">${esc(item.unit)}</td>
            <td class="col-qty">${fmtQty(item.quantity)}</td>
            <td class="col-pu">${fmtCLP(item.unitPrice)}</td>
            <td class="col-total">${fmtCLP(item.total)}</td>
          </tr>`
          )
          .join("")}
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACION OBRA — ${esc(project.name)}</title>
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
      <h1 class="doc-title">${esc(budget.version)} COTIZACION OBRA</h1>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      <div class="field">
        <div class="label">Fecha</div>
        <div class="value">${dateStr}</div>
      </div>
      ${
        project.clientPhone
          ? `<div class="field"><div class="label">Celular</div><div class="value">${esc(project.clientPhone)}</div></div>`
          : ""
      }
      ${
        project.ufReference != null
          ? `<div class="field"><div class="label">Valor UF</div><div class="value">${fmtCLP(project.ufReference)}</div></div>`
          : ""
      }
    </div>
  </div>


  <!-- TABLE -->
  <table class="partidas">
    <thead>
      <tr>
        <th class="col-item">ITEM</th>
        <th class="col-name">PARTIDA</th>
        <th class="col-desc">DESCRIPCION</th>
        <th class="col-unit">UN.</th>
        <th class="col-qty">CANT.</th>
        <th class="col-pu">P.U.</th>
        <th class="col-total">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <table class="totals">
      <tr>
        <td class="t-label">COSTO DIRECTO</td>
        <td class="t-pct"></td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(costoDirecto).toLocaleString("es-CL")}</td>
      </tr>
      <tr>
        <td class="t-label">GASTOS GENERALES</td>
        <td class="t-pct">${ggPct}%</td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(gg).toLocaleString("es-CL")}</td>
      </tr>
      <tr>
        <td class="t-label">UTILIDADES</td>
        <td class="t-pct">${utilPct}%</td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(utilidad).toLocaleString("es-CL")}</td>
      </tr>
      <tr>
        <td class="t-label">COSTO NETO</td>
        <td class="t-pct"></td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(neto).toLocaleString("es-CL")}</td>
      </tr>
      <tr>
        <td class="t-label">IVA</td>
        <td class="t-pct">19%</td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(iva).toLocaleString("es-CL")}</td>
      </tr>
      <tr class="total">
        <td class="t-label">COSTO TOTAL</td>
        <td class="t-pct"></td>
        <td class="t-cur">$</td>
        <td class="t-val">${Math.round(total).toLocaleString("es-CL")}</td>
      </tr>
    </table>
  </div>

  <!-- FORMAS DE PAGO -->
  <div class="payment-wrap">
    <div class="section-title">FORMAS DE PAGO</div>
    <table class="payment">
      ${terms
        .map(
          (t) => `
        <tr>
          <td class="p-stage">${esc(t.stage)}</td>
          <td class="p-pct">${t.percentage}%</td>
        </tr>`
        )
        .join("")}
    </table>
  </div>

  <!-- OBSERVACIONES -->
  <div class="obs-wrap">
    <div class="section-title">OBSERVACIONES GENERALES</div>
    <div class="obs-grid">
    ${OBSERVACIONES.map(
      (obs, i) => `
      <div class="obs-item">
        <div class="obs-num">${i + 1}.</div>
        <div class="obs-text">${esc(obs)}</div>
      </div>`
    ).join("")}
    </div>
  </div>

</body>
</html>`;
}

/**
 * Footer template for Puppeteer's displayHeaderFooter.
 * Puppeteer's footer runs in an isolated sandbox — Montserrat is unavailable,
 * so fall back to Arial. Inline styles only.
 */
export function buildObraFooter(version: string, date: string | Date): string {
  const dateStr = fmtDate(date);
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      font-weight: 400;
      color: #808080;
      width: 100%;
      padding: 4px 15mm 0;
      margin: 0;
      border-top: 0.5pt solid #CCC;
      display: flex;
      justify-content: space-between;
    ">
      <span>blarq.cl</span>
      <span>${esc(version)} — ${dateStr}</span>
    </div>
  `;
}
