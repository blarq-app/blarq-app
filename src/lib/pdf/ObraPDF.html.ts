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
// El layout y proporciones replican el cuadro Excel master que MJ usaba
// para sus cotizaciones. Cambios clave vs versiones anteriores:
//   - Header en 2 columnas: lado izq (logo + Mandante/Proyecto/Direccion),
//     lado der (Version big + Pro a cargo + Celular/Fecha/Valor UF).
//   - Tabla con bordes en TODAS las celdas (estilo Excel), no solo bottom.
//   - Headers de tabla con bg gris #DBDBDB.
//   - Totales en 4 columnas: LABEL | % | $ | VALUE — el $ separado del nro.
//   - Forma de Pago + Observaciones más compactas estilo Excel.
const CSS = `
  @page { size: A4; margin: 14mm 16mm 14mm 16mm; }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 7pt;
    font-weight: 400;
    color: #000;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  /* Layout 2 columnas: izquierda logo+Mandante/Proyecto/Direccion;
     derecha Version+Pro a cargo+Celular/Fecha/Valor UF.
     Match Excel reference. */
  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 30px;
    margin-bottom: 8px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo {
    display: block;
    height: 38px;
    width: auto;
    margin-bottom: 12px;
  }
  .logo-text {
    font-size: 5.5pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.08em;
    margin-top: -8px;
    margin-bottom: 12px;
  }

  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 16pt;
    font-weight: 500;
    color: #808080;
    line-height: 1;
    margin: 0 0 2px 0;
    letter-spacing: 0.02em;
  }
  .doc-subtitle {
    font-size: 8pt;
    font-weight: 500;
    color: #808080;
    letter-spacing: 0.06em;
    margin: 0 0 10px 0;
    text-transform: uppercase;
  }

  .field { margin-bottom: 4px; }
  .field .label {
    font-size: 6pt;
    font-weight: 400;
    color: #404040;
    letter-spacing: 0;
    margin-bottom: 0;
    line-height: 1.1;
  }
  .field .value {
    font-size: 7pt;
    font-weight: 700;
    color: #000;
    line-height: 1.1;
    text-transform: uppercase;
  }

  /* ── Table ──────────────────────────────────────────────────── */
  /* Bordes en TODAS las celdas (estilo Excel). */
  table.partidas {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 6pt;
    margin-top: 6px;
  }
  .partidas th, .partidas td {
    padding: 2px 4px;
    vertical-align: middle;
    border: 0.5pt solid #000;
    word-wrap: break-word;
    line-height: 1.15;
  }
  .partidas thead th {
    background: #DBDBDB;
    color: #000;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 4px;
    font-size: 6pt;
    text-align: center;
  }
  .partidas tr.chapter-row td {
    background: #DBDBDB;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2.5px 4px;
    font-size: 6.5pt;
  }
  .partidas tr.chapter-row td.chapter-idx { text-align: center; }

  /* Column widths (must sum to 100%) */
  .col-item   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-name   { width: 21%; text-align: left; font-weight: 600; }
  .col-desc   { width: 40%; text-align: left; font-size: 6pt; font-weight: 400; }
  .col-unit   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-qty    { width: 7%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-pu     { width: 10%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-total  { width: 12%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }

  /* ── Totals ─────────────────────────────────────────────────── */
  /* Estilo Excel: 4 columnas — LABEL | % | $ | VALUE.
     Sin bordes salvo top en COSTO TOTAL. Alineado a la derecha. */
  .totals-wrap {
    width: 100%;
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  table.totals {
    border-collapse: collapse;
    font-size: 6.5pt;
  }
  .totals td {
    padding: 1.5px 4px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    border: none;
    color: #000;
  }
  .totals .t-label { text-align: left; text-transform: uppercase; font-weight: 400; white-space: nowrap; padding-right: 14px; }
  .totals .t-pct   { text-align: right; white-space: nowrap; padding-right: 12px; min-width: 28px; }
  .totals .t-cur   { text-align: right; white-space: nowrap; padding-right: 2px; }
  .totals .t-val   { text-align: right; white-space: nowrap; min-width: 70px; }
  .totals tr.total td {
    border-top: 1pt solid #000;
    font-weight: 700;
    padding-top: 3px;
  }

  /* ── Section titles — match Excel: subrayado fino sin negrita */
  .section-title {
    font-size: 7pt;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #000;
    margin: 0 0 4px 0;
    padding: 0;
    border-bottom: 0.5pt solid #000;
    padding-bottom: 1px;
    display: inline-block;
  }
  .section-title-italic {
    font-size: 7pt;
    font-weight: 400;
    font-style: italic;
    color: #000;
    margin: 0 0 4px 0;
    padding-bottom: 1px;
    border-bottom: 0.5pt solid #000;
    display: inline-block;
  }

  /* ── Payment terms — estilo Excel compacto ─────────────────── */
  .payment-wrap { margin-top: 18px; }
  table.payment { border-collapse: collapse; font-size: 6.5pt; }
  .payment td { padding: 1px 0; border: none; }
  .payment .p-stage { padding-right: 24px; font-weight: 400; }
  .payment .p-pct { text-align: right; font-variant-numeric: tabular-nums; min-width: 30px; }

  /* ── Observaciones — estilo Excel, lista numerada compacta ──── */
  .obs-wrap  { margin-top: 14px; page-break-inside: avoid; }
  .obs-item {
    display: flex;
    gap: 4px;
    margin-bottom: 1.5px;
    font-size: 6pt;
    line-height: 1.3;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .obs-num { flex: 0 0 12px; font-weight: 400; color: #000; }
  .obs-text { flex: 1; color: #000; }

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

  // Formato CLP en tabla: P.U. va sin $ (solo número), TOTAL va con
  // "$ XXX.XXX" con espacio — para que matchee al cuadro Excel master.
  const fmtNum = (n: number) => Math.round(n).toLocaleString("es-CL");
  const fmtMoney = (n: number) => "$ " + Math.round(n).toLocaleString("es-CL");

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
            <td class="col-pu">${fmtNum(item.unitPrice)}</td>
            <td class="col-total">${fmtMoney(item.total)}</td>
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

  <!-- HEADER — match Excel reference exact -->
  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div class="logo-text">BLANCO LARRAÍN ARQUITECTOS</div>
      <div class="field">
        <div class="label">Mandante:</div>
        <div class="value">${esc(project.clientName)}</div>
      </div>
      <div class="field">
        <div class="label">Proyecto:</div>
        <div class="value">${esc(project.name)}</div>
      </div>
      <div class="field">
        <div class="label">Direccion:</div>
        <div class="value">${esc(project.address || "—")}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="field"><div class="label">Version:</div></div>
      <h1 class="doc-title">${esc(budget.version)} COTIZACION</h1>
      <div class="doc-subtitle">OBRA</div>
      <div class="field">
        <div class="label">Profesional a cargo:</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      ${
        project.clientPhone
          ? `<div class="field"><div class="label">Celular:</div><div class="value">${esc(project.clientPhone)}</div></div>`
          : ""
      }
      <div class="field">
        <div class="label">Fecha:</div>
        <div class="value">${dateStr}</div>
      </div>
      ${
        project.ufReference != null
          ? `<div class="field"><div class="label">Valor UF:</div><div class="value">$ ${Math.round(project.ufReference).toLocaleString("es-CL")}</div></div>`
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
        <th class="col-unit">UNIDAD</th>
        <th class="col-qty">CANTIDAD</th>
        <th class="col-pu">P.U</th>
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

  <!-- FORMAS DE PAGO — title en cursiva como el Excel -->
  <div class="payment-wrap">
    <div class="section-title-italic">Formas de Pago</div>
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

  <!-- OBSERVACIONES GENERALES -->
  <div class="obs-wrap">
    <div class="section-title">OBSERVACIONES GENERALES:</div>
    ${OBSERVACIONES.map(
      (obs, i) => `
      <div class="obs-item">
        <div class="obs-num">${i + 1}.</div>
        <div class="obs-text">${esc(obs)}</div>
      </div>`
    ).join("")}
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
