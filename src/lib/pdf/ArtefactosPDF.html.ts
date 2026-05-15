/**
 * HTML+CSS renderer del PDF de Artefactos.
 *
 * El formato imita el Excel que se usaba antes (referencia: planilla MK /
 * TEKA / LedStudio), adaptado a la línea editorial BLARQ (sin colores
 * fuertes, tipografía Montserrat, grises sutiles).
 *
 * Estructura:
 *   - Header BLARQ con metadata (mandante, proyecto, dirección, profesional,
 *     fecha, versión).
 *   - Por cada subcategoría (Sanitarios → Cocina → Iluminación):
 *     - Banner de subcategoría ("ARTEFACTOS SANITARIOS").
 *     - Por cada habitación con items dentro:
 *       - Banner gris medio ("BAÑO PRINCIPAL 1").
 *       - Header de tabla: ITEM | DETALLE | MARCA | CANT. | P. LISTA | DCTO | TOTAL.
 *       - Items.
 *       - Subtotal del room ("TOTAL PRECIO ARTEFACTOS BAÑO PRINCIPAL").
 *     - Subtotal de subcategoría ("TOTAL PRECIO ARTEFACTOS SANITARIOS").
 *   - Total general ("TOTAL PRECIO ARTEFACTOS").
 *   - Forma de pago.
 *   - Observaciones.
 *
 * NOTA: el costo interno BLARQ (NETO MK, utilidad) NUNCA va al PDF del
 * cliente — solo se ve en el editor.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "MARÍA JOSÉ BLANCO";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Despacho", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

// Labels canónicos para rooms — coinciden con la key del modelo BD.
const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

// Orden de aparición por defecto dentro de una subcategoría.
const ROOM_ORDER = [
  "bano_principal",
  "bano_secundario",
  "bano_visita",
  "cocina",
  "lavadero",
  "otro",
];

// Labels y orden de subcategorías.
const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Artefactos sanitarios",
  cocina: "Artefactos cocina",
  iluminacion: "Artefactos iluminación",
};
const SUBCATEGORY_ORDER = ["sanitario", "cocina", "iluminacion"];

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
  subcategory: string;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null; // decimal 0..1 (no porcentaje 0..100)
  clientPrice: number; // unitario (no incluye qty)
  imageUrl: string | null; // URL de la imagen del producto
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

function fmtPct(d: number | null): string {
  if (d === null || d === undefined) return "—";
  if (d === 0) return "0%";
  return Math.round(d * 100) + "%";
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
// Línea editorial BLARQ: misma base que obra/muebles — sin colores, fonts
// Montserrat, grises sutiles, tabular-nums en numéricas.
const CSS = `
  @page { size: A4; }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 9pt;
    font-weight: 400;
    color: #1A1A1A;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Header (logo + metadata) ───────────────────────────────────────── */
  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 40px;
    margin-bottom: 10px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo { display: block; height: 36px; width: auto; margin-bottom: 8px; }

  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 13pt;
    font-weight: 500;
    color: #808080;
    line-height: 1.1;
    margin: 0 0 8px 0;
    letter-spacing: 0.02em;
  }

  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 12px;
    row-gap: 2px;
  }
  .header-right .meta { grid-template-columns: 1fr auto; }
  .meta .m-label {
    font-size: 6pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.4;
  }
  .meta .m-value {
    font-size: 7.5pt;
    font-weight: 500;
    color: #1A1A1A;
    line-height: 1.4;
  }

  /* ── Subcategoría: banner "ARTEFACTOS SANITARIOS" ──────────────────── */
  .subcat-banner {
    margin-top: 12px;
    padding: 5px 8px;
    background: #1A1A1A;
    color: #fff;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── Tabla por subcategoría ────────────────────────────────────────── */
  .artefactos {
    width: 100%;
    margin-top: 0;
    border-collapse: collapse;
    font-size: 7.5pt;
    page-break-inside: auto;
  }
  .artefactos thead tr.h-room td {
    background: #E5E5E5;
    color: #1A1A1A;
    font-weight: 700;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 6px;
    border-bottom: 0.5pt solid #999;
  }
  .artefactos thead tr.h-cols th {
    background: #F5F5F5;
    color: #555;
    font-weight: 600;
    font-size: 6.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 6px;
    border-bottom: 0.5pt solid #999;
    text-align: left;
  }
  .artefactos tbody td {
    padding: 3px 6px;
    border-bottom: 0.25pt solid #E5E5E5;
    vertical-align: top;
    line-height: 1.25;
  }
  .artefactos tr.subtotal-room td {
    padding: 4px 6px;
    border-top: 0.5pt solid #1A1A1A;
    border-bottom: 0.5pt solid #1A1A1A;
    font-weight: 600;
    font-size: 7.5pt;
  }
  .artefactos tr.subtotal-sub td {
    padding: 5px 6px;
    border-top: 1pt solid #1A1A1A;
    background: #F5F5F5;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 8pt;
  }

  .col-img      { width: 7%; text-align: center; padding: 4px; }
  .col-img img  { max-width: 32px; max-height: 32px; object-fit: contain; display: block; margin: 0 auto; }
  .col-name     { width: 14%; font-weight: 600; }
  .col-detail   { width: 33%; color: #333; }
  .col-brand    { width: 9%; color: #555; }
  .col-qty      { width: 5%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-list     { width: 10%; text-align: right; font-variant-numeric: tabular-nums; }
  .col-discount { width: 6%;  text-align: right; font-variant-numeric: tabular-nums; color: #555; }
  .col-price    { width: 14%; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  /* Evitar que un item se parta entre páginas. */
  .artefactos tbody tr { page-break-inside: avoid; }

  /* ── Total general ─────────────────────────────────────────────────── */
  .total-general {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }
  .total-general table {
    border-collapse: collapse;
    font-size: 9pt;
  }
  .total-general td {
    padding: 6px 14px;
    font-variant-numeric: tabular-nums;
    border-top: 1.5pt solid #1A1A1A;
    border-bottom: 1.5pt solid #1A1A1A;
  }
  .total-general .t-label {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9pt;
    text-align: right;
  }
  .total-general .t-val {
    text-align: right;
    min-width: 110px;
    font-weight: 700;
    font-size: 10pt;
  }

  /* ── Forma de pago ──────────────────────────────────────────────────── */
  .payment-wrap { margin-top: 18px; page-break-inside: avoid; }
  .section-title {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #1A1A1A;
    margin-bottom: 6px;
    padding-bottom: 2px;
    border-bottom: 0.5pt solid #999;
  }
  .payment { width: 45%; border-collapse: collapse; font-size: 7.5pt; }
  .payment td { padding: 3px 8px; border-bottom: 0.25pt solid #E5E5E5; }
  .payment .p-stage { width: 70%; }
  .payment .p-pct   { width: 30%; text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Observaciones ──────────────────────────────────────────────────── */
  .obs-wrap { margin-top: 18px; page-break-inside: avoid; }
  .obs-item {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 7pt;
    line-height: 1.45;
  }
  .obs-num { flex: 0 0 14px; font-weight: 700; color: #808080; }
  .obs-text { flex: 1; color: #333; }
  .extra-obs {
    margin-top: 10px;
    padding: 8px 10px;
    background: #F5F5F5;
    border-left: 2pt solid #808080;
    font-size: 7pt;
    line-height: 1.45;
    color: #333;
  }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
export function renderArtefactosHTML(input: ArtefactosHTMLInput): string {
  const { project, budget, items, paymentTerms } = input;

  // Agrupar por subcategoría → room
  type RoomGroup = {
    key: string;
    label: string;
    items: ArtefactoItemInput[];
    subtotal: number;
  };
  type SubcatGroup = {
    key: string;
    label: string;
    rooms: RoomGroup[];
    subtotal: number;
  };

  const subcatBuckets = new Map<string, ArtefactoItemInput[]>();
  for (const it of items) {
    const key = it.subcategory || "sanitario";
    const arr = subcatBuckets.get(key) ?? [];
    arr.push(it);
    subcatBuckets.set(key, arr);
  }

  const orderedSubcats: SubcatGroup[] = [];
  const subcatKeysSorted = Array.from(subcatBuckets.keys()).sort((a, b) => {
    const ia = SUBCATEGORY_ORDER.indexOf(a);
    const ib = SUBCATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  for (const subKey of subcatKeysSorted) {
    const subItems = subcatBuckets.get(subKey) ?? [];
    const roomBuckets = new Map<string, ArtefactoItemInput[]>();
    for (const it of subItems) {
      const k = it.room || "otro";
      const arr = roomBuckets.get(k) ?? [];
      arr.push(it);
      roomBuckets.set(k, arr);
    }
    const roomKeysSorted = Array.from(roomBuckets.keys()).sort((a, b) => {
      const ia = ROOM_ORDER.indexOf(a);
      const ib = ROOM_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const rooms: RoomGroup[] = roomKeysSorted.map((rkey) => {
      const rItems = roomBuckets.get(rkey) ?? [];
      const subtotal = rItems.reduce(
        (s, it) => s + it.clientPrice * it.quantity,
        0
      );
      return {
        key: rkey,
        label: ROOM_LABELS[rkey] ?? rkey,
        items: rItems,
        subtotal,
      };
    });
    const subtotal = rooms.reduce((s, r) => s + r.subtotal, 0);
    orderedSubcats.push({
      key: subKey,
      label: SUBCATEGORY_LABELS[subKey] ?? subKey,
      rooms,
      subtotal,
    });
  }

  const totalCliente = items.reduce(
    (sum, i) => sum + i.clientPrice * i.quantity,
    0
  );

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:36px;font-size:22pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  // Render por subcategoría. Cada room = mini-tabla con su propio thead +
  // tbody + subtotal-row. La subcategoría termina con un subtotal-sub.
  const subcatsHtml = orderedSubcats
    .map((sub) => {
      const roomsHtml = sub.rooms
        .map(
          (r) => `
        <table class="artefactos">
          <thead>
            <tr class="h-room">
              <td colspan="8">${esc(r.label)}</td>
            </tr>
            <tr class="h-cols">
              <th class="col-img"></th>
              <th class="col-name">Item</th>
              <th class="col-detail">Detalle</th>
              <th class="col-brand">Marca</th>
              <th class="col-qty">Cant.</th>
              <th class="col-list">P. lista</th>
              <th class="col-discount">Dcto</th>
              <th class="col-price">Total</th>
            </tr>
          </thead>
          <tbody>
            ${r.items
              .map(
                (it) => `
              <tr>
                <td class="col-img">${
                  it.imageUrl
                    ? `<img src="${esc(it.imageUrl)}" alt="" />`
                    : ""
                }</td>
                <td class="col-name">${esc(it.name)}</td>
                <td class="col-detail">${esc(it.detail || "")}</td>
                <td class="col-brand">${esc(it.brand || "—")}</td>
                <td class="col-qty">${it.quantity}</td>
                <td class="col-list">${
                  it.listPrice > 0 ? fmtCLP(it.listPrice) : "—"
                }</td>
                <td class="col-discount">${fmtPct(it.discountPercent)}</td>
                <td class="col-price">${fmtCLP(it.clientPrice * it.quantity)}</td>
              </tr>`
              )
              .join("")}
            <tr class="subtotal-room">
              <td colspan="7">Total artefactos ${esc(r.label.toLowerCase())}</td>
              <td class="col-price">${fmtCLP(r.subtotal)}</td>
            </tr>
          </tbody>
        </table>`
        )
        .join("");

      return `
        <div class="subcat-banner">${esc(sub.label)}</div>
        ${roomsHtml}
        <table class="artefactos">
          <tbody>
            <tr class="subtotal-sub">
              <td colspan="7">Total ${esc(sub.label.toLowerCase())}</td>
              <td class="col-price">${fmtCLP(sub.subtotal)}</td>
            </tr>
          </tbody>
        </table>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACIÓN ARTEFACTOS — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div class="meta">
        <div class="m-label">Mandante</div>
        <div class="m-value">${esc(project.clientName)}</div>
        <div class="m-label">Proyecto</div>
        <div class="m-value">${esc(project.name)}</div>
        <div class="m-label">Dirección</div>
        <div class="m-value">${esc(project.address || "—")}</div>
      </div>
    </div>
    <div class="header-right">
      <h1 class="doc-title">${esc(budget.version)} COTIZACIÓN ARTEFACTOS</h1>
      <div class="meta">
        <div class="m-value">${esc(PROFESSIONAL)}</div>
        <div class="m-label">Profesional</div>
        <div class="m-value">${dateStr}</div>
        <div class="m-label">Fecha</div>
      </div>
    </div>
  </div>

  ${subcatsHtml}

  <div class="total-general">
    <table>
      <tr>
        <td class="t-label">Total artefactos</td>
        <td class="t-val">${fmtCLP(totalCliente)}</td>
      </tr>
    </table>
  </div>

  <div class="payment-wrap">
    <div class="section-title">Forma de pago</div>
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
    <div class="section-title">Observaciones</div>
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

// El footer se mantiene por compat — el route.tsx decide si usarlo o no
// (con la nueva línea editorial, no se usa).
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
