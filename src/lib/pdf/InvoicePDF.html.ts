// HTML template para "vista interna" del DTE recibido/emitido.
// Lo consume renderPDF() (Puppeteer). NO es el DTE oficial del SII —
// es un resumen generado por BLARQ desde los datos sincronizados, útil
// para revisar/imprimir cuando no se tiene el PDF original a mano.

const DTE_LABEL: Record<number, string> = {
  33: "Factura electrónica",
  34: "Factura exenta electrónica",
  39: "Boleta electrónica",
  41: "Boleta exenta electrónica",
  52: "Guía de despacho electrónica",
  56: "Nota de débito electrónica",
  61: "Nota de crédito electrónica",
};

export interface InvoicePDFInput {
  type: "emitida" | "recibida";
  tipoDoc: number | null;
  folioNumber: string | null;
  issueDate: Date;
  rutIssuer: string | null;
  rutReceiver: string | null;
  businessName: string | null;
  netAmount: number;
  iva: number;
  totalAmount: number;
  status: string;
  origin: string;
  notes: string | null;
  referenceFolioNumber: string | null;
  referenceTipoDoc: number | null;
  project: { name: string } | null;
  category: { name: string } | null;
  syncedAt: Date | null;
}

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

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function fmtRut(rut: string | null): string {
  if (!rut) return "—";
  return rut;
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

export function renderInvoiceHtml(inv: InvoicePDFInput): string {
  const docLabel = DTE_LABEL[inv.tipoDoc ?? 33] ?? "Documento";
  const directionLabel = inv.type === "recibida" ? "RECIBIDA" : "EMITIDA";
  const counterpartLabel = inv.type === "recibida" ? "Proveedor" : "Cliente";
  const counterpartRut = inv.type === "recibida" ? inv.rutIssuer : inv.rutReceiver;
  const blarqRut = "77.270.733-9";
  const blarqLabel = inv.type === "recibida" ? "Receptor" : "Emisor";

  const refRow =
    inv.referenceFolioNumber && inv.referenceTipoDoc
      ? `<tr><td class="lbl">Referencia a:</td><td>${
          esc(DTE_LABEL[inv.referenceTipoDoc] ?? "Documento")
        } folio <strong>${esc(inv.referenceFolioNumber)}</strong></td></tr>`
      : "";

  const notesBlock = inv.notes
    ? `<div class="block">
         <div class="block-title">Notas internas</div>
         <div class="notes">${esc(inv.notes)}</div>
       </div>`
    : "";

  const syncedNote = inv.syncedAt
    ? `Sincronizado del SII el ${fmtDate(inv.syncedAt)}.`
    : "Cargado manualmente en BLARQ.";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(docLabel)} ${esc(inv.folioNumber ?? "")}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    margin: 0;
    padding: 18mm 16mm;
    font-size: 11pt;
    line-height: 1.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #111827;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .brand {
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .brand-sub {
    font-size: 9pt;
    color: #6b7280;
    margin-top: 2px;
  }
  .doc-id {
    text-align: right;
  }
  .doc-id .label {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .doc-id .folio {
    font-size: 18pt;
    font-weight: 700;
    color: #111827;
    margin-top: 2px;
  }
  .doc-id .type {
    font-size: 10pt;
    color: #374151;
    margin-top: 4px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 18px;
  }
  .party {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 10px 12px;
    background: #fafafa;
  }
  .party .role {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .party .name {
    font-size: 12pt;
    font-weight: 600;
    color: #111827;
  }
  .party .rut {
    font-size: 10pt;
    color: #4b5563;
    margin-top: 2px;
  }
  .amounts {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 18px;
  }
  .amounts table {
    width: 100%;
    border-collapse: collapse;
  }
  .amounts td {
    padding: 8px 12px;
    border-bottom: 1px solid #f3f4f6;
  }
  .amounts td.lbl {
    color: #6b7280;
    width: 60%;
  }
  .amounts td.val {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .amounts tr.total td {
    border-top: 2px solid #111827;
    border-bottom: none;
    font-weight: 700;
    font-size: 13pt;
    background: #f9fafb;
  }
  .block {
    margin-bottom: 14px;
  }
  .block-title {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .kv {
    width: 100%;
    border-collapse: collapse;
  }
  .kv td {
    padding: 4px 0;
    vertical-align: top;
  }
  .kv td.lbl {
    color: #6b7280;
    width: 35%;
  }
  .notes {
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 10pt;
    color: #374151;
    white-space: pre-wrap;
  }
  .footer {
    position: fixed;
    bottom: 14mm;
    left: 16mm;
    right: 16mm;
    font-size: 8pt;
    color: #9ca3af;
    border-top: 1px solid #e5e7eb;
    padding-top: 6px;
    line-height: 1.4;
  }
  .badge {
    display: inline-block;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: #f3f4f6;
    color: #374151;
    padding: 2px 6px;
    border-radius: 3px;
    margin-left: 6px;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">BLARQ</div>
      <div class="brand-sub">Vista interna del documento</div>
    </div>
    <div class="doc-id">
      <div class="label">${esc(docLabel)} ${directionLabel}</div>
      <div class="folio">N° ${esc(inv.folioNumber ?? "—")}</div>
      <div class="type">Fecha emisión: ${fmtDate(inv.issueDate)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="party">
      <div class="role">${counterpartLabel}</div>
      <div class="name">${esc(inv.businessName ?? "—")}</div>
      <div class="rut">RUT ${fmtRut(counterpartRut)}</div>
    </div>
    <div class="party">
      <div class="role">${blarqLabel}</div>
      <div class="name">BLARQ</div>
      <div class="rut">RUT ${blarqRut}</div>
    </div>
  </div>

  <div class="amounts">
    <table>
      <tr><td class="lbl">Monto neto</td><td class="val">${fmtCLP(inv.netAmount)}</td></tr>
      <tr><td class="lbl">IVA</td><td class="val">${fmtCLP(inv.iva)}</td></tr>
      <tr class="total"><td class="lbl">TOTAL</td><td class="val">${fmtCLP(inv.totalAmount)}</td></tr>
    </table>
  </div>

  <div class="block">
    <div class="block-title">Asignación interna</div>
    <table class="kv">
      <tr><td class="lbl">Proyecto</td><td>${esc(inv.project?.name ?? "Sin asignar")}</td></tr>
      <tr><td class="lbl">Categoría</td><td>${esc(inv.category?.name ?? "Sin asignar")}</td></tr>
      <tr><td class="lbl">Estado de pago</td><td>${esc(STATUS_LABEL[inv.status] ?? inv.status)}</td></tr>
      ${refRow}
    </table>
  </div>

  ${notesBlock}

  <div class="footer">
    <strong>Documento de uso interno generado por BLARQ.</strong>
    No es el DTE oficial del SII — para el documento legal consulte el portal del SII.
    ${syncedNote}
  </div>
</body>
</html>`;
}
