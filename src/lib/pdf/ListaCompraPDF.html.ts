/**
 * HTML+CSS renderer for the Lista de Compra PDF.
 * Same content as legacy ListaCompraPDF.tsx (landscape layout, summary
 * cards, 9-column materials table) — rendered via HTML/Puppeteer.
 */

import fs from "node:fs";
import path from "node:path";

export interface ListaCompraRow {
  name: string;
  unit: string;
  qtyNeeded: number;
  qtyBought: number;
  unitPrice: number | null;
  notes: string | null;
  source: "budget" | "manual" | "excess";
}

export interface ListaCompraHTMLInput {
  projectName: string;
  budgetVersion: string;
  filter: "todo" | "pendiente" | "comprado";
  rows: ListaCompraRow[];
  generatedAt: string;
}

const FILTER_LABEL: Record<string, string> = {
  todo: "Todos los materiales",
  pendiente: "Pendientes de compra",
  comprado: "Materiales comprados",
};

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

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("es-CL");
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
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
  @page { size: A4 landscape; margin: 10mm 12mm 14mm 12mm; }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 8pt;
    font-weight: 400;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1.5pt solid #1a1a1a;
    padding-bottom: 8px;
    margin-bottom: 14px;
  }
  .header-left .logo {
    height: 28px;
    width: auto;
    display: block;
    margin-bottom: 2px;
  }
  .header-left .logo-fallback {
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: 0.18em;
    margin-bottom: 2px;
  }
  .header-left .sub { font-size: 7pt; color: #888; }
  .header-right { text-align: right; }
  .doc-title {
    font-size: 12pt;
    font-weight: 700;
    margin: 0 0 2px 0;
  }
  .doc-meta { font-size: 7pt; color: #888; line-height: 1.3; }

  /* Summary cards */
  .summary {
    display: grid;
    grid-template-columns: 1.2fr 1.2fr 1.2fr 0.8fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  .summary-card {
    border: 0.5pt solid #e0e0e0;
    border-radius: 4px;
    padding: 6px 10px;
    background: #fafafa;
  }
  .summary-card.green { background: #f0fdf4; border-color: #bbf7d0; }
  .summary-card.green .summary-value { color: #166534; }
  .summary-card.orange { background: #fff7ed; border-color: #fed7aa; }
  .summary-card.orange .summary-value { color: #c2410c; }
  .summary-label { font-size: 7pt; color: #888; margin-bottom: 2px; }
  .summary-value {
    font-size: 11pt;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .summary-note { font-size: 6pt; color: #aaa; margin-top: 1px; }

  /* Table */
  table.materials { width: 100%; border-collapse: collapse; }
  table.materials thead th {
    background: #1a1a1a;
    color: #fff;
    font-size: 7pt;
    font-weight: 700;
    padding: 6px 5px;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.materials tbody td {
    padding: 4px 5px;
    border-bottom: 0.5pt solid #ebebeb;
    font-size: 7pt;
    vertical-align: middle;
  }
  table.materials tbody tr.alt td { background: #fafafa; }
  table.materials tbody tr.done td { background: #f0fdf4; }

  .col-check  { width: 4%;  text-align: center; }
  .col-name   { width: 28%; }
  .col-unit   { width: 6%;  text-align: center; }
  .col-nec    { width: 10%; text-align: right; font-variant-numeric: tabular-nums; }
  .col-comp   { width: 10%; text-align: right; font-variant-numeric: tabular-nums; }
  .col-pend   { width: 10%; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .col-pend.has-pend { color: #c2410c; }
  .col-pend.no-pend  { color: #9ca3af; }
  .col-price  { width: 13%; text-align: right; font-variant-numeric: tabular-nums; }
  .col-total  { width: 13%; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .col-notes  { width: 6%;  font-size: 6.5pt; color: #555; }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
export function renderListaCompraHTML(input: ListaCompraHTMLInput): string {
  const { projectName, budgetVersion, filter, rows, generatedAt } = input;

  const rowsWithPrice = rows.filter(
    (r) => r.unitPrice != null && r.qtyNeeded > 0
  );
  const totalPpto = rowsWithPrice.reduce(
    (s, r) => s + r.qtyNeeded * r.unitPrice!,
    0
  );
  const totalComprado = rowsWithPrice.reduce(
    (s, r) => s + Math.min(r.qtyBought, r.qtyNeeded) * r.unitPrice!,
    0
  );
  const totalPend = rowsWithPrice.reduce(
    (s, r) => s + Math.max(0, r.qtyNeeded - r.qtyBought) * r.unitPrice!,
    0
  );
  const completados = rows.filter(
    (r) => r.qtyBought >= r.qtyNeeded && r.qtyNeeded > 0
  ).length;

  const logoUri = getLogoDataUri();
  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo-fallback">BLARQ</div>`;

  const summaryHtml =
    rowsWithPrice.length > 0
      ? `
        <div class="summary">
          <div class="summary-card">
            <div class="summary-label">Total presupuestado</div>
            <div class="summary-value">${fmtCLP(totalPpto)}</div>
            <div class="summary-note">neto s/IVA</div>
          </div>
          <div class="summary-card green">
            <div class="summary-label">Ya comprado</div>
            <div class="summary-value">${fmtCLP(totalComprado)}</div>
            <div class="summary-note">neto s/IVA</div>
          </div>
          <div class="summary-card orange">
            <div class="summary-label">Por comprar</div>
            <div class="summary-value">${fmtCLP(totalPend)}</div>
            <div class="summary-note">neto s/IVA</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Materiales</div>
            <div class="summary-value">${rows.length}</div>
            <div class="summary-note">${completados} completados</div>
          </div>
        </div>`
      : "";

  const rowsHtml = rows
    .map((row, idx) => {
      const pend = Math.max(0, row.qtyNeeded - row.qtyBought);
      const done = pend <= 0.001 && row.qtyNeeded > 0;
      const totalRow =
        row.unitPrice != null ? row.qtyNeeded * row.unitPrice : null;
      const rowClass = done ? "done" : idx % 2 === 1 ? "alt" : "";
      const pendClass =
        pend > 0.001 ? "col-pend has-pend" : "col-pend no-pend";
      return `
        <tr class="${rowClass}">
          <td class="col-check">${done ? "✓" : "○"}</td>
          <td class="col-name">${esc(row.name)}</td>
          <td class="col-unit">${esc(row.unit)}</td>
          <td class="col-nec">${fmtNum(row.qtyNeeded)}</td>
          <td class="col-comp">${row.qtyBought > 0 ? fmtNum(row.qtyBought) : "—"}</td>
          <td class="${pendClass}">${pend > 0.001 ? fmtNum(pend) : "—"}</td>
          <td class="col-price">${row.unitPrice != null ? fmtCLP(row.unitPrice) : "—"}</td>
          <td class="col-total">${totalRow != null ? fmtCLP(totalRow) : "—"}</td>
          <td class="col-notes">${esc(row.notes || "")}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>BLARQ Lista de Compra — ${esc(projectName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div class="sub">Lista de Compra · ${esc(projectName)}</div>
    </div>
    <div class="header-right">
      <div class="doc-title">Lista de Compra</div>
      <div class="doc-meta">${esc(FILTER_LABEL[filter] || filter)}</div>
      <div class="doc-meta">Presupuesto: ${esc(budgetVersion)}</div>
      <div class="doc-meta">${esc(generatedAt)}</div>
    </div>
  </div>

  ${summaryHtml}

  <table class="materials">
    <thead>
      <tr>
        <th class="col-check">✓</th>
        <th class="col-name">Material</th>
        <th class="col-unit">Und</th>
        <th class="col-nec">Necesario</th>
        <th class="col-comp">Comprado</th>
        <th class="col-pend">Pendiente</th>
        <th class="col-price">P. Unit neto</th>
        <th class="col-total">Total $</th>
        <th class="col-notes">Notas</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

</body>
</html>`;
}

export function buildListaCompraFooter(projectName: string): string {
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 6.5pt;
      color: #aaa;
      width: 100%;
      padding: 4px 12mm 0;
      border-top: 0.5pt solid #ccc;
      display: flex;
      justify-content: space-between;
    ">
      <span>BLARQ · Lista de Compra · ${esc(projectName)}</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  `;
}
