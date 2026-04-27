/**
 * HTML+CSS renderer for the Artefactos budget PDF.
 * Same content shape as the legacy @react-pdf ArtefactosPDF.tsx (rooms,
 * 6-column table) — rendered via HTML/Puppeteer for fidelity and to keep
 * the PDF pipeline unified.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "MARÍA JOSÉ BLANCO";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Despacho", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

const ROOMS: Record<string, string> = {
  bano_principal: "Baño Principal",
  bano_secundario: "Baño Secundario",
  bano_visita: "Baño Visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

const OBSERVACIONES = [
  "Los artefactos cotizados están sujetos a disponibilidad de stock al momento del pago del anticipo.",
  "Los descuentos aplicados son sobre precio lista del proveedor y son válidos solo para esta cotización.",
  "Tiempo de despacho: 7 a 15 días hábiles tras pago de anticipo, dependiendo del proveedor.",
  "Esta cotización tiene una validez de 10 días corridos.",
  "Los precios pueden variar por ajustes del proveedor o tipo de cambio.",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface ArtefactoItemInput {
  room: string;
  name: string;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null;
  clientPrice: number;
}

export interface PaymentTermInput {
  stage: string;
  percentage: number;
}

export interface ArtefactosHTMLInput {
  project: {
    name: string;
    clientName: string;
    address: string | null;
  };
  budget: {
    version: string;
    date: string | Date;
    observations: string | null;
  };
  items: ArtefactoItemInput[];
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

  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 40px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo { display: block; height: 44px; width: auto; margin-bottom: 6px; }

  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 14pt;
    font-weight: 500;
    color: #808080;
    line-height: 1;
    margin: 0 0 6px 0;
  }

  .field { margin-bottom: 3px; }
  .field .label {
    font-size: 6pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.2;
  }
  .field .value {
    font-size: 7.5pt;
    font-weight: 500;
    color: #000;
    line-height: 1.2;
  }

  /* ── Tables ─────────────────────────────────────────────────── */
  .partidas {
    width: 100%;
    margin-top: 14px;
    border-collapse: collapse;
    font-size: 7pt;
  }
  .partidas thead th {
    background: #DBDBDB;
    color: #000;
    font-weight: 700;
    font-size: 6.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 6px;
    border: 0.5pt solid #000;
    text-align: left;
  }
  .partidas tbody td {
    padding: 3px 6px;
    border-bottom: 0.5pt solid #CCCCCC;
    vertical-align: top;
  }
  .partidas .room-row td {
    background: #F2F2F2;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 7pt;
    padding: 4px 6px;
  }
  .partidas .subtotal-row td {
    background: #FAFAFA;
    font-weight: 600;
    font-size: 6.5pt;
    border-top: 0.5pt solid #999;
    border-bottom: 0.5pt solid #999;
  }
  .col-name     { width: 32%; }
  .col-brand    { width: 16%; }
  .col-qty      { width: 6%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-list     { width: 14%; text-align: right; font-variant-numeric: tabular-nums; }
  .col-discount { width: 8%;  text-align: right; font-variant-numeric: tabular-nums; }
  .col-price    { width: 24%; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  /* ── Totals ─────────────────────────────────────────────────── */
  .totals-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals { font-size: 8pt; border-collapse: collapse; }
  .totals td { padding: 4px 10px; font-variant-numeric: tabular-nums; }
  .totals .t-label {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 7.5pt;
    letter-spacing: 0.05em;
    text-align: right;
  }
  .totals .t-val { text-align: right; min-width: 80px; }
  .totals .total td {
    border-top: 1pt solid #000;
    background: #DBDBDB;
    font-size: 9pt;
    font-weight: 700;
  }

  /* ── Forma de pago ──────────────────────────────────────────── */
  .payment-wrap { margin-top: 18px; }
  .section-title {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #000;
    margin-bottom: 6px;
    padding-bottom: 2px;
    border-bottom: 0.5pt solid #999;
  }
  .payment { width: 50%; border-collapse: collapse; font-size: 7pt; }
  .payment td { padding: 3px 8px; border-bottom: 0.5pt solid #CCC; }
  .payment .p-stage { width: 70%; text-transform: capitalize; }
  .payment .p-pct   { width: 30%; text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Observaciones ─────────────────────────────────────────── */
  .obs-wrap { margin-top: 18px; page-break-inside: avoid; }
  .obs-item {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 7pt;
    line-height: 1.4;
  }
  .obs-num { flex: 0 0 14px; font-weight: 700; color: #555; }
  .obs-text { flex: 1; color: #333; }

  .extra-obs {
    margin-top: 12px;
    padding: 8px;
    background: #F8F8F8;
    border-left: 2pt solid #999;
    font-size: 7pt;
    line-height: 1.45;
    color: #333;
  }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
export function renderArtefactosHTML(input: ArtefactosHTMLInput): string {
  const { project, budget, items, paymentTerms } = input;

  const byRoom = Object.entries(ROOMS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((i) => i.room === key),
      subtotal: items
        .filter((i) => i.room === key)
        .reduce((sum, i) => sum + i.clientPrice, 0),
    }))
    .filter((r) => r.items.length > 0);

  const totalCliente = items.reduce((sum, i) => sum + i.clientPrice, 0);

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:60px;font-size:28pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = byRoom
    .map(
      (r) => `
        <tr class="room-row">
          <td class="col-name" colspan="6">${esc(r.label)}</td>
        </tr>
        ${r.items
          .map(
            (item) => `
          <tr>
            <td class="col-name">${esc(item.name)}</td>
            <td class="col-brand">${esc(item.brand || "—")}</td>
            <td class="col-qty">${item.quantity}</td>
            <td class="col-list">${fmtCLP(item.listPrice)}</td>
            <td class="col-discount">${
              item.discountPercent ? item.discountPercent + "%" : "—"
            }</td>
            <td class="col-price">${fmtCLP(item.clientPrice)}</td>
          </tr>`
          )
          .join("")}
        <tr class="subtotal-row">
          <td class="col-name" colspan="5">Subtotal ${esc(r.label)}</td>
          <td class="col-price">${fmtCLP(r.subtotal)}</td>
        </tr>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACION ARTEFACTOS — ${esc(project.name)}</title>
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
        <div class="label">Dirección</div>
        <div class="value">${esc(project.address || "—")}</div>
      </div>
    </div>
    <div class="header-right">
      <h1 class="doc-title">${esc(budget.version)} COTIZACION ARTEFACTOS</h1>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
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
        <th class="col-name">ARTEFACTO</th>
        <th class="col-brand">MARCA</th>
        <th class="col-qty">CANT.</th>
        <th class="col-list">P. LISTA</th>
        <th class="col-discount">DCTO</th>
        <th class="col-price">PRECIO</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr class="total">
        <td class="t-label">TOTAL</td>
        <td class="t-val">${fmtCLP(totalCliente)}</td>
      </tr>
    </table>
  </div>

  <div class="payment-wrap">
    <div class="section-title">FORMA DE PAGO</div>
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

  <div class="obs-wrap">
    <div class="section-title">OBSERVACIONES</div>
    ${OBSERVACIONES.map(
      (obs, i) => `
      <div class="obs-item">
        <div class="obs-num">${i + 1}.</div>
        <div class="obs-text">${esc(obs)}</div>
      </div>`
    ).join("")}
    ${
      budget.observations
        ? `<div class="extra-obs">${esc(budget.observations)}</div>`
        : ""
    }
  </div>

</body>
</html>`;
}

export function buildArtefactosFooter(
  version: string,
  date: string | Date
): string {
  const dateStr = fmtDate(date);
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      color: #808080;
      width: 100%;
      padding: 4px 14mm 0;
      border-top: 0.5pt solid #CCC;
      display: flex;
      justify-content: space-between;
    ">
      <span>blarq.cl</span>
      <span>${esc(version)} — ${dateStr}</span>
    </div>
  `;
}
