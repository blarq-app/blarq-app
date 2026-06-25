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
  "Garantías: Durante la etapa de diseño se podrá revisar minuciosamente todos los detalles del proyecto hasta que haya una absoluta satisfacción por parte del cliente. Luego de aprobado el diseño, todos los cambios tendrán un costo adicional. No nos hacemos responsables por alteraciones en los muebles y cubiertas una vez recibidos a entera satisfacción del cliente.",
  "Este presupuesto tiene una validez de 10 días corridos.",
  "Estos valores podrán sufrir modificaciones si existen variaciones considerables con las medidas rectificadas en terreno.",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface MuebleDetailInput {
  name: string;
  material: string;
}

export interface MuebleHerrajeInput {
  sector: string;
  name: string;
  measure: string | null;
  finish: string | null;
  quantity: number;
}

export interface MuebleItemInput {
  itemNumber: string;
  name: string;
  descriptionGeneral: string | null;
  quantity: number;
  clientPriceIva: number;
  details: MuebleDetailInput[];
  // Partidas de herrajes: el detalle son herrajes agrupados por sector, sin
  // precio por línea (el precio es el total de la partida). null/[] = no aplica.
  herrajes?: MuebleHerrajeInput[];
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
// Misma línea editorial que ObraPDF: tipografía suave (#1A1A1A, no negro),
// header con grilla 2-cols pareadas, tabla sin verticales y con líneas
// internas finísimas, totales sutiles sin marco rectangular.
const CSS = `
  @page { size: A4; margin: 10mm 12mm; }

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

  /* ── Header ─────────────────────────────────────────────────── */
  .header-strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 30px;
    margin-bottom: 4pt;
    align-items: start;
  }
  .header-strip .strip-left  { text-align: left; }
  .header-strip .strip-right { text-align: right; }

  .header-fields {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 6pt;
  }
  .header-fields .col-left,
  .header-fields .col-right {
    display: flex;
    flex-direction: column;
    gap: 2pt;
  }
  .header-fields .col-right { text-align: left; }

  .logo { display: block; height: 45px; width: auto; margin-bottom: 2pt; }

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
    margin: 0 0 4pt 0;
    text-transform: uppercase;
  }

  .field { margin-bottom: 1pt; }
  .field .label {
    font-size: 6pt;
    font-weight: 400;
    color: #808080;
    line-height: 1.1;
  }
  .field .value {
    font-size: 8pt;
    font-weight: 500;
    color: #1A1A1A;
    line-height: 1.1;
    text-transform: uppercase;
  }

  /* ── Tabla principal — misma estética que Obra ──────────────── */
  table.partidas {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: 'Montserrat', sans-serif;
    font-size: 6.5pt;
    margin-top: 0;
  }
  /* Cuerpo: sin bordes verticales, líneas internas muy sutiles. */
  .partidas th, .partidas td {
    border: none;
    border-bottom: 0.15pt solid #E5E5E5;
    padding: 2pt 5pt;
    vertical-align: top;
    word-wrap: break-word;
    line-height: 1.2;
    font-weight: 400;
    font-size: 6.5pt;
    color: #1A1A1A;
  }
  /* Header tabla — sin fill, solo líneas top/bottom */
  .partidas thead th {
    background: transparent;
    color: #1A1A1A;
    font-weight: 500;
    text-transform: uppercase;
    text-align: center;
    font-size: 7pt;
    padding: 2pt 5pt;
    white-space: nowrap;
    vertical-align: middle;
    border-top: 0.5pt solid #1A1A1A;
    border-bottom: 0.5pt solid #1A1A1A;
  }

  /* Fila de capítulo (1 COCINA, 2 BAÑO, …) */
  .chapter-row td {
    background: #E5E5E5;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 6.5pt;
    padding: 1.5pt 5pt;
    border-bottom: 0.15pt solid #E5E5E5;
    color: #1A1A1A;
    vertical-align: middle;
  }

  /* Fila ítem (1.1 MUEBLES, 1.2 CUBIERTA, …) — cada partida arranca un bloque.
     Separación entre partidas = aire arriba (padding-top) + el título en negrita
     más grande. NO lleva línea arriba (esa "sobraba" debajo del desglose previo).
     La única línea de la partida es la tenue de abajo del título (border-bottom
     heredado), que separa el título de su desglose. */
  .item-row td {
    font-weight: 600;
    font-size: 6.5pt;
    padding: 3pt 5pt 1pt;
  }
  .item-desc-general {
    font-weight: 400;
    font-style: italic;
    color: #555;
    font-size: 5.5pt;
    margin-top: 0.5pt;
  }

  /* Detalle (CUERPO INTERIOR / FRENTES PUERTAS / etc) — indentados bajo su
     partida (sin línea vertical), más chicos que el título. */
  .detail-row td {
    padding: 0.3pt 5pt;
    font-size: 5.5pt;
    border-bottom: none;
    color: #1A1A1A;
  }
  /* El primer componente arranca con un poco de aire para que la línea de abajo
     del título no quede chocando con el desglose. */
  .detail-row-first td {
    padding-top: 2pt;
  }
  .detail-row .col-detail-name {
    font-weight: 500;
    text-transform: uppercase;
    padding-left: 18px;
    color: #1A1A1A;
  }
  .detail-row .col-detail-material {
    color: #555;
    font-weight: 400;
  }

  /* Column widths (suman 100%) */
  .col-num   { width: 6%;  text-align: center; white-space: nowrap; }
  .col-name  { width: 70%; text-align: left; }
  .col-qty   { width: 9%;  text-align: center; font-variant-numeric: tabular-nums; }
  .col-total { width: 15%; text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Totales — sutil, línea top/bottom, sin marco ───────────── */
  .totals-wrap {
    width: 100%;
    margin-top: 2pt;
    display: flex;
    justify-content: flex-end;
    /* Que el bloque del total no se parta entre páginas (la nota "Valor IVA
       incluido" se quedaba sola en la hoja siguiente). Margen y padding
       reducidos para que el bloque (total + nota) entre en la misma página que
       el listado y no salte a la hoja 2. */
    break-inside: avoid;
    page-break-inside: avoid;
  }
  table.totals {
    border-collapse: collapse;
    font-family: 'Montserrat', sans-serif;
    font-size: 7pt;
    width: 55%;
    margin-left: auto;
    border: none;
    border-top: 0.5pt solid #1A1A1A;
    border-bottom: 0.5pt solid #1A1A1A;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .totals td {
    padding: 1.5pt 6pt;
    background: transparent;
    color: #1A1A1A;
    font-variant-numeric: tabular-nums;
  }
  .totals tr, .totals .t-val {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .totals .t-label {
    text-align: left;
    text-transform: uppercase;
    font-weight: 700;
    font-size: 7.5pt;
    padding-left: 2pt;
  }
  .totals .t-val {
    text-align: right;
    font-weight: 700;
    font-size: 7.5pt;
    white-space: nowrap;
  }
  /* Nota bajo el monto: "valor IVA incluido", chica y discreta. */
  .totals .t-note {
    text-align: right;
    font-weight: 400;
    font-style: italic;
    font-size: 5.5pt;
    color: #555;
    margin-top: 0;
  }

  /* ── Section titles ─────────────────────────────────────────── */
  .section-title {
    font-size: 7pt;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #1A1A1A;
    margin: 0 0 2pt 0;
    border-bottom: 0.5pt solid #1A1A1A;
    padding-bottom: 1px;
    display: inline-block;
  }
  .section-title-italic {
    font-size: 7pt;
    font-weight: 400;
    font-style: italic;
    color: #1A1A1A;
    margin: 0 0 2pt 0;
    padding-bottom: 1px;
    border-bottom: 0.5pt solid #1A1A1A;
    display: inline-block;
  }

  /* ── Formas de pago ─────────────────────────────────────────── */
  .payment-wrap { margin-top: 8pt; }
  table.payment { border-collapse: collapse; font-size: 6.5pt; }
  .payment td { padding: 0.5pt 0; border: none; line-height: 1.2; color: #1A1A1A; }
  .payment .p-stage { padding-right: 24px; font-weight: 400; }
  .payment .p-pct { text-align: right; font-variant-numeric: tabular-nums; min-width: 30px; }

  /* ── Observaciones ──────────────────────────────────────────── */
  .obs-wrap { margin-top: 8pt; }
  .obs-item {
    display: flex;
    gap: 4px;
    margin-bottom: 0;
    font-size: 6.5pt;
    line-height: 1.25;
  }
  .obs-num { flex: 0 0 12px; font-weight: 400; color: #1A1A1A; }
  .obs-text { flex: 1; color: #1A1A1A; }

  .extra-obs {
    margin-top: 6pt;
    padding: 6px;
    background: #F8F8F8;
    border-left: 1.5pt solid #999;
    font-size: 6pt;
    line-height: 1.35;
    color: #333;
  }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
// Detalle de una partida de herrajes en el PDF al cliente: los herrajes
// agrupados por SECTOR (sub-encabezado) y listados con su medida/color y
// cantidad, SIN precio por línea (el precio es el total de la partida). Es el
// equivalente, para herrajes, del detalle de componentes de un mueble.
function renderHerrajeDetailRows(
  herrajes: MuebleHerrajeInput[] | undefined
): string {
  if (!herrajes || herrajes.length === 0) return "";
  // Agrupar por sector preservando el orden de aparición.
  const order: string[] = [];
  const bySector = new Map<string, MuebleHerrajeInput[]>();
  for (const h of herrajes) {
    const key = h.sector || "";
    if (!bySector.has(key)) {
      bySector.set(key, []);
      order.push(key);
    }
    bySector.get(key)!.push(h);
  }
  return order
    .map((sector) => {
      const lines = bySector.get(sector)!;
      const header = sector
        ? `<tr class="detail-row"><td></td><td class="col-detail-name" colspan="3"><strong>${esc(
            sector.toUpperCase()
          )}</strong></td></tr>`
        : "";
      const rows = lines
        .map((h) => {
          // Medida/color en MAYÚSCULA, como en el editor y el catálogo.
          const spec = [h.measure, h.finish]
            .filter(Boolean)
            .join(" · ")
            .toUpperCase();
          const qty = `${fmtQty(h.quantity)} un`;
          return `
          <tr class="detail-row">
            <td></td>
            <td class="col-detail-name" colspan="3">
              <span style="display:inline-block;min-width:120px;">${esc(h.name)}</span>
              <span class="col-detail-material">${esc(spec)}${
                spec ? " · " : ""
              }${esc(qty)}</span>
            </td>
          </tr>`;
        })
        .join("");
      return header + rows;
    })
    .join("");
}

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

  // Orden canónico dentro del capítulo: Muebles → Cubiertas → Herrajes.
  // El resto (cualquier otro tipo) cae al final por fallback. MJ pidió
  // este orden específico para que el PDF salga consistente sin importar
  // cómo se hayan ingresado los items en el editor.
  function itemOrder(name: string): number {
    const u = (name || "").toUpperCase();
    if (u.includes("MUEBLE")) return 1;
    if (u.includes("CUBIERTA")) return 2;
    if (u.includes("HERRAJ")) return 3;
    return 99;
  }

  const tableRows = chapters
    .map((ch, chIdx) => {
      // Número de capítulo e ítem DERIVADOS por posición (igual que el editor en
      // pantalla): así nunca queda hueco aunque se haya borrado una partida. No
      // usamos ch.chapterNumber / item.itemNumber guardados (que arrastran el
      // hueco). El orden de los ítems lo sigue fijando itemOrder (nombre).
      const chapterNumber = chIdx + 1;
      const sortedItems = [...ch.items].sort(
        (a, b) => itemOrder(a.name) - itemOrder(b.name)
      );
      const chapterSubtotal = sortedItems.reduce(
        (s, i) => s + i.clientPriceIva * i.quantity,
        0
      );
      return `
      <tr class="chapter-row">
        <td class="col-num">${chapterNumber}</td>
        <td class="col-name">${esc(ch.name)}</td>
        <td class="col-qty"></td>
        <td class="col-total">${fmtCLP(chapterSubtotal)}</td>
      </tr>
      ${sortedItems
        .map(
          (item, itemIdx) => `
        <tr class="item-row">
          <td class="col-num">${chapterNumber}.${itemIdx + 1}</td>
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
            (d, di) => `
          <tr class="detail-row${di === 0 ? " detail-row-first" : ""}">
            <td></td>
            <td class="col-detail-name" colspan="3">
              <span style="display:inline-block;min-width:120px;">${esc(d.name)}</span>
              <span class="col-detail-material">${esc(d.material)}</span>
            </td>
          </tr>`
          )
          .join("")}
        ${renderHerrajeDetailRows(item.herrajes)}
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

  <!-- 1) Franja: logo (izq) + título + Pro a cargo (der) -->
  <div class="header-strip">
    <div class="strip-left">
      ${logoHtml}
    </div>
    <div class="strip-right">
      <div class="field"><div class="label">Version:</div></div>
      <h1 class="doc-title">${esc(budget.version)} COTIZACION</h1>
      <div class="doc-subtitle">MUEBLES</div>
      <div class="field">
        <div class="label">Profesional a cargo:</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
    </div>
  </div>

  <!-- 2) Header fields: izquierda (Mandante/Proyecto/Direccion)
       pegada al borde izq; derecha (Celular/Fecha/Valor UF)
       pegada al borde derecho. -->
  <div class="header-fields">
    <div class="col-left">
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
    <div class="col-right">
      <div class="field">
        <div class="label">Celular:</div>
        <div class="value">${esc(project.clientPhone || "—")}</div>
      </div>
      <div class="field">
        <div class="label">Fecha:</div>
        <div class="value">${dateStr}</div>
      </div>
      <div class="field">
        <div class="label">Valor UF:</div>
        <div class="value">${project.ufReference != null ? "$ " + Math.round(project.ufReference).toLocaleString("es-CL") : "—"}</div>
      </div>
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
        <td class="t-val">${fmtCLP(totalIva)}<div class="t-note">Valor IVA incluido</div></td>
      </tr>
    </table>
  </div>

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

  <div class="obs-wrap">
    <div class="section-title">OBSERVACIONES GENERALES:</div>
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

