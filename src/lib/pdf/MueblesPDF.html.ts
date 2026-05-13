/**
 * HTML+CSS renderer for the Muebles budget PDF.
 * Match exacto al formato BLARQ Excel: capítulos numerados, items con
 * descripción general, detalles de componentes con materialidad multi-línea.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "MARÍA JOSÉ BLANCO";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Inicio Instalación", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

const OBSERVACIONES = [
  "Plazos de Entrega: 60 días corridos para muebles al momento de ingreso a producción, excepto en caso de fuerza mayor. Las cubiertas Cuarzo y Granito tiene un plazo de 10 días hábiles para instalar, después de su rectificación.",
  "Condiciones de entrega: Los muebles ingresarán una vez puestos los cerámicos de muros con el frague seco, instalación de agua y desagüe. En caso de haber pintura, debe estar seca. Las cubiertas solo se podrán rectificar una vez instalados los muebles base.",
  "Garantías: Durante la etapa de diseño se podrá revisar minuciosamente todos los detalles del proyecto hasta que haya una absoluta satisfacción por parte del cliente. Luego de aprobado el diseño, todos los cambios tendrán un costo adicional. No nos hacemos responsables por alteraciones en los muebles y cubiertas una vez recibidos a entera satisfacción del cliente. Los artefactos tienen su garantía directamente con la empresa. Si los artefactos son intervenidos, pierden su garantía.",
  "Este presupuesto tiene una validez de 10 días corridos.",
  "Estos valores podrán sufrir modificaciones si existen variaciones considerables con las medidas rectificadas en terreno.",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface MuebleDetailInput {
  name: string;
  material: string;
}

export interface MuebleItemInput {
  itemNumber: string;
  name: string;
  descriptionGeneral: string | null;
  quantity: number;
  clientPriceIva: number;
  details: MuebleDetailInput[];
}

export interface MuebleChapterInput {
  chapterNumber: number;
  name: string;
  items: MuebleItemInput[];
}

export interface PaymentTermInput {
  stage: string;
  percentage: number;
}

export interface MueblesHTMLInput {
  project: {
    name: string;
    clientName: string;
    clientPhone?: string | null;
    address: string | null;
    ufReference?: number | null;
  };
  budget: {
    version: string;
    date: string | Date;
    observations: string | null;
  };
  chapters: MuebleChapterInput[];
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
    font-size: 8pt;
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

  .logo { display: block; height: 36px; width: auto; margin-bottom: 4px; }

  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 11pt;
    font-weight: 500;
    color: #808080;
    line-height: 1;
    margin: 0 0 4px 0;
  }

  .field { margin-bottom: 2px; }
  .field .label {
    font-size: 5.5pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.15;
  }
  .field .value {
    font-size: 6.5pt;
    font-weight: 500;
    color: #000;
    line-height: 1.15;
  }

  /* ── Tabla principal — match al cuadro Excel master, compacto ──── */
  .partidas {
    width: 100%;
    margin-top: 8px;
    border-collapse: collapse;
    font-size: 6pt;
  }
  .partidas thead th {
    background: #DBDBDB;
    color: #000;
    font-weight: 700;
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1.5px 4px;
    border: 0.4pt solid #000;
    text-align: left;
  }
  .partidas tbody td {
    padding: 0.8px 4px;
    border-bottom: 0.4pt solid #CCCCCC;
    vertical-align: top;
  }

  /* Capítulo (1 MUEBLES DE COCINA) */
  .chapter-row td {
    background: #DBDBDB;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 6pt;
    padding: 2px 4px;
    border-top: 0.4pt solid #000;
    border-bottom: 0.4pt solid #000;
  }
  .chapter-row .col-num { width: 22px; }

  /* Item (1.1 MUEBLES) */
  .item-row td {
    font-weight: 600;
    font-size: 6pt;
    padding: 1.2px 4px;
  }
  .item-row .col-num { width: 22px; padding-right: 0; tabular-nums: true; }
  .item-desc-general {
    font-weight: 400;
    font-style: italic;
    color: #555;
    font-size: 5.5pt;
    margin-top: 0;
  }

  /* Detalle (CUERPO INTERIOR / TRASERA / etc) */
  .detail-row td {
    background: #FBFBFB;
    padding: 0.5px 4px;
    font-size: 5.5pt;
    border-bottom: none;
  }
  .detail-row .col-detail-name {
    font-weight: 600;
    text-transform: uppercase;
    color: #333;
    padding-left: 18px;
  }
  .detail-row .col-detail-material {
    color: #555;
  }

  .col-qty   { width: 50px; text-align: center; font-variant-numeric: tabular-nums; }
  .col-total { width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
  .col-name  { /* default flex */ }

  /* ── Totales ─────────────────────────────────────────────────── */
  .totals-wrap { margin-top: 10px; display: flex; justify-content: flex-end; }
  .totals { font-size: 6.5pt; border-collapse: collapse; }
  .totals td { padding: 2px 8px; font-variant-numeric: tabular-nums; }
  .totals .t-label {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 6pt;
    letter-spacing: 0.05em;
    text-align: right;
  }
  .totals .t-val { text-align: right; min-width: 80px; }
  .totals .total td {
    border-top: 0.5pt solid #000;
    background: #DBDBDB;
    font-size: 7pt;
    font-weight: 700;
  }

  /* ── Forma de pago ──────────────────────────────────────────── */
  .payment-wrap { margin-top: 12px; }
  .section-title {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #000;
    margin-bottom: 3px;
    padding-bottom: 1px;
    border-bottom: 0.5pt solid #999;
  }
  .payment { width: 50%; border-collapse: collapse; font-size: 5.5pt; }
  .payment td { padding: 1.5px 6px; border-bottom: 0.4pt solid #CCC; }
  .payment .p-stage { width: 70%; }
  .payment .p-pct   { width: 30%; text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Observaciones ─────────────────────────────────────────── */
  .obs-wrap { margin-top: 12px; page-break-inside: avoid; }
  .obs-item {
    display: flex;
    gap: 6px;
    margin-bottom: 2px;
    font-size: 5.5pt;
    line-height: 1.3;
  }
  .obs-num { flex: 0 0 12px; font-weight: 700; color: #555; }
  .obs-text { flex: 1; color: #333; }

  .extra-obs {
    margin-top: 8px;
    padding: 6px;
    background: #F8F8F8;
    border-left: 1.5pt solid #999;
    font-size: 5.5pt;
    line-height: 1.35;
    color: #333;
  }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
export function renderMueblesHTML(input: MueblesHTMLInput): string {
  const { project, budget, chapters, paymentTerms } = input;

  const totalIva = chapters
    .flatMap((c) => c.items)
    .reduce((sum, i) => sum + i.clientPriceIva * i.quantity, 0);

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:60px;font-size:28pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = chapters
    .map((ch) => {
      const chapterSubtotal = ch.items.reduce(
        (s, i) => s + i.clientPriceIva * i.quantity,
        0
      );
      return `
      <tr class="chapter-row">
        <td class="col-num">${ch.chapterNumber}</td>
        <td class="col-name">${esc(ch.name)}</td>
        <td class="col-qty"></td>
        <td class="col-total">${fmtCLP(chapterSubtotal)}</td>
      </tr>
      ${ch.items
        .map(
          (item) => `
        <tr class="item-row">
          <td class="col-num">${esc(item.itemNumber)}</td>
          <td class="col-name">
            ${esc(item.name)}
            ${
              item.descriptionGeneral
                ? `<div class="item-desc-general">${esc(item.descriptionGeneral)}</div>`
                : ""
            }
          </td>
          <td class="col-qty">${fmtQty(item.quantity)}</td>
          <td class="col-total">${fmtCLP(item.clientPriceIva * item.quantity)}</td>
        </tr>
        ${item.details
          .map(
            (d) => `
          <tr class="detail-row">
            <td></td>
            <td class="col-detail-name" colspan="3">
              <span style="display:inline-block;min-width:120px;">${esc(d.name)}</span>
              <span class="col-detail-material">${esc(d.material)}</span>
            </td>
          </tr>`
          )
          .join("")}
      `
        )
        .join("")}
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACION MUEBLES — ${esc(project.name)}</title>
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
      <h1 class="doc-title">${esc(budget.version)} COTIZACION MUEBLES</h1>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      ${
        project.clientPhone
          ? `<div class="field"><div class="label">Celular</div><div class="value">${esc(project.clientPhone)}</div></div>`
          : ""
      }
      <div class="field">
        <div class="label">Fecha</div>
        <div class="value">${dateStr}</div>
      </div>
      ${
        project.ufReference != null
          ? `<div class="field"><div class="label">Valor UF</div><div class="value">${fmtCLP(project.ufReference)}</div></div>`
          : ""
      }
    </div>
  </div>

  <table class="partidas">
    <thead>
      <tr>
        <th class="col-num">ITEM</th>
        <th class="col-name">PARTIDA / DESCRIPCION</th>
        <th class="col-qty">CANTIDAD</th>
        <th class="col-total">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr class="total">
        <td class="t-label">COSTO TOTAL MUEBLES</td>
        <td class="t-val">${fmtCLP(totalIva)}</td>
      </tr>
    </table>
  </div>

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

  <div class="obs-wrap">
    <div class="section-title">OBSERVACIONES GENERALES</div>
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

export function buildMueblesFooter(
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
