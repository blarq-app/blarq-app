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

// Línea (serie) y color/terminación derivados del nombre del artefacto, igual
// que en el editor de la cotización (ArtefactosEditor): el nombre ya trae la
// línea y el color, acá solo los extraemos para mostrarlos como columnas en el
// PDF. Línea en MAYÚSCULA. NO se guardan en la BD.
const LINEA_RULES: Array<[RegExp, string]> = [
  [/NEW DELFOS/, "New Delfos"], [/NEW HOME/, "New Home"], [/STYLE-?N|\bSTYLE\b/, "Style"],
  [/ASIS/, "Asis"], [/URBAN/, "Urban"], [/STELLAR/, "Stellar"], [/ATLAS/, "Atlas"],
  [/\bHOME\b/, "Home"], [/LUXOR/, "Luxor"], [/TRENTO/, "Trento"], [/\bZEN\b/, "Zen"],
  [/BROOKLIN/, "Brooklin"], [/NIZA/, "Niza"], [/BRIZO/, "Brizo"], [/ATENAS/, "Atenas"],
  [/ALBANY/, "Albany"], [/DELFOS/, "Delfos"], [/QUEEN/, "Queen"], [/NEPAL/, "Nepal"],
  [/AMANTIA/, "Amantia"], [/ARES/, "Ares"], [/ASTORIA/, "Astoria"],
];
const COLOR_RULES: Array<[RegExp, string]> = [
  [/BRUSHED NICKEL/, "Brushed Nickel"], [/GUN GREY/, "Gun Grey"], [/NEGRO MATE/, "Negro Mate"],
  [/RUSTIC OAK/, "Rustic Oak"], [/WHITE OAK/, "White Oak"], [/MINK GREY/, "Mink Grey"],
  [/MOON GREY/, "Moon Grey"], [/BRUSHED/, "Brushed"], [/CROMAD[OA]|CROMO/, "Cromo"],
  [/BLANCO/, "Blanco"], [/\bINOX|INOXIDABLE/, "Inox"],
];
function lineaDe(name: string, detail?: string | null): string {
  const n = `${name} ${detail ?? ""}`.toUpperCase();
  for (const [re, v] of LINEA_RULES) if (re.test(n)) return v;
  return "";
}
function colorDe(name: string, detail?: string | null): string {
  const n = `${name} ${detail ?? ""}`.toUpperCase();
  for (const [re, v] of COLOR_RULES) if (re.test(n)) return v;
  return "";
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
    font-size: 7pt;
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

  .logo { display: block; height: 45px; width: auto; margin-bottom: 2pt; }

  /* Título e subtítulo: mismas specs que el PDF de obra (18pt / 9pt, gris). */
  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 18pt;
    font-weight: 400;
    color: #808080;
    line-height: 1;
    margin: 0;
    letter-spacing: 0.02em;
  }
  .doc-subtitle {
    font-size: 9pt;
    font-weight: 400;
    color: #808080;
    letter-spacing: 0.06em;
    margin: 0 0 6px 0;
    text-transform: uppercase;
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
    font-size: 8pt;
    font-weight: 500;
    color: #1A1A1A;
    line-height: 1.3;
    text-transform: uppercase;
  }

  /* ── Subcategoría: banner "ARTEFACTOS SANITARIOS" ──────────────────── */
  /* Banner de subcategoría — mismo gris que las filas de capítulo del PDF
     de obra (#E5E5E5), no negro, para que los dos documentos se lean igual. */
  .subcat-banner {
    margin-top: 12px;
    padding: 4px 6px;
    background: #E5E5E5;
    color: #1A1A1A;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* ── Tabla por subcategoría ────────────────────────────────────────── */
  .artefactos {
    width: 100%;
    margin-top: 0;
    border-collapse: collapse;
    font-size: 7.5pt;
    page-break-inside: auto;
  }
  /* Banner de ambiente (BAÑO PRINCIPAL…) — gris claro como las filas de
     sub-capítulo (zona) del PDF de obra. */
  .artefactos thead tr.h-room td {
    background: #F5F5F5;
    color: #555;
    font-weight: 500;
    font-size: 6.5pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 6px;
    border-bottom: 0.25pt solid #E5E5E5;
  }
  /* Encabezado de columnas — sin relleno, con regla arriba y abajo, igual
     que el thead del PDF de obra. */
  .artefactos thead tr.h-cols th {
    background: transparent;
    color: #1A1A1A;
    font-weight: 500;
    font-size: 6.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2pt 6px;
    border-top: 0.5pt solid #1A1A1A;
    border-bottom: 0.5pt solid #1A1A1A;
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

  /* Imagen del producto: tamaño visualizable, no como icono. El Excel de
     referencia renderiza imágenes entre 20mm y 30mm — apuntamos al
     extremo superior (~32mm = ~120px) para que el cliente identifique
     el producto sin tener que abrir el link. */
  .col-img      { width: 16%; text-align: center; padding: 8px 4px; vertical-align: middle; }
  .col-img img  { max-width: 120px; max-height: 120px; object-fit: contain; display: block; margin: 0 auto; }
  .col-name     { width: 12%; font-weight: 600; }
  .col-line     { width: 7%;  color: #1A1A1A; font-weight: 500; text-transform: uppercase; }
  .col-finish   { width: 7%;  color: #555; }
  .col-detail   { width: 17%; color: #333; }
  .col-brand    { width: 7%;  color: #555; }
  .col-qty      { width: 4%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-list     { width: 9%;  text-align: right; font-variant-numeric: tabular-nums; }
  .col-discount { width: 5%;  text-align: right; font-variant-numeric: tabular-nums; color: #555; }
  .col-price    { width: 12%; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  /* Las filas con imagen son más altas — alineamos verticalmente al medio
     todas las celdas para que el texto quede centrado contra la foto. */
  .artefactos tbody td { vertical-align: middle; }

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
              <td colspan="10">${esc(r.label)}</td>
            </tr>
            <tr class="h-cols">
              <th class="col-img"></th>
              <th class="col-name">Item</th>
              <th class="col-line">Línea</th>
              <th class="col-finish">Color</th>
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
                <td class="col-line">${esc(lineaDe(it.name, it.detail) || "—")}</td>
                <td class="col-finish">${esc(colorDe(it.name, it.detail) || "—")}</td>
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
              <td colspan="9">Total artefactos ${esc(r.label.toLowerCase())}</td>
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
              <td colspan="9">Total ${esc(sub.label.toLowerCase())}</td>
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
      <h1 class="doc-title">${esc(budget.version)} COTIZACIÓN</h1>
      <div class="doc-subtitle">Artefactos</div>
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
