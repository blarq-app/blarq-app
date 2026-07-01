/**
 * HTML+CSS renderer del PDF de Obra.
 * Consumido por renderPDF() (Puppeteer). Se renderiza a A4 SIN márgenes
 * (el route pasa margin:0 para obra) — el aire lo pone el padding interno.
 *
 * Línea editorial: Manual de Marca BLARQ v2 (Claro). Fuente de verdad del
 * diseño: "Presupuesto Obra Imprimible" de Claude Design. Tres roles
 * tipográficos: Hanken Grotesk (títulos, altas finas), Spectral (bajadas
 * itálicas) y Nunito Sans (cuerpo, datos y cifras tabulares). Paleta greige.
 *
 * Correcciones pedidas por MJ sobre el borrador de Design:
 *   - Portada SIN "Inversión total" (no se muestra el total en la portada).
 *   - Tablas SIN subtotales: ni el de capítulo ("Subtotal $X") ni los de zona
 *     ("Cocina $X" / "Baños $X"). Quedan solo las partidas; la banda de zona
 *     se mantiene como separador (sin monto).
 *   - "Formas de pago" bien visible.
 * El cuadro final (costo directo → costo total) y las observaciones se mantienen.
 */

import fs from "node:fs";
import path from "node:path";
import { sanitizeRichTextHtml } from "@/lib/richText";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 40 },
  { stage: "Avance", percentage: 25 },
  { stage: "Avance", percentage: 25 },
  { stage: "Saldo", percentage: 10 },
];

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "Demoliciones", index: 1 },
  reparaciones: { label: "Reparaciones", index: 2 },
  sanitarias: { label: "Instalaciones sanitarias y gasfitería", index: 3 },
  electricas: { label: "Instalaciones eléctricas", index: 4 },
  terminaciones: { label: "Terminaciones", index: 5 },
  limpieza: { label: "Limpieza y aseo", index: 6 },
};

const OBSERVACIONES = [
  "Mandante dejará libre los accesos y las superficies a intervenir, dispondrá de suministro eléctrico y de agua potable, además de baño para las personas que trabajen en la obra.",
  "Todo aumento de obra se recargará al costo directo según los precios unitarios más un recargo del mismo porcentaje en GG expresado en la oferta.",
  "No se consideran Permisos Municipales ni de administración del Condominio dentro de este presupuesto.",
  "Esta cotización tiene una validez de 10 días corridos.",
  "Los pagos se harán con el valor de la UF del día, y solo se aceptarán pagos por transferencia bancaria o con tarjeta por medio de link de pago, en cuyo caso se agregará la comisión de Transbank.",
  "Los valores expresados en la cotización podrían variar luego de visitar la propiedad.",
  "Al aprobar la cotización se autoriza a la empresa BLARQ a publicar contenido en Redes Sociales y página web: fotos y videos del avance y estado de la obra, y a la instalación de publicidad hacia el exterior de la obra (terrazas, balcones, portón).",
  "Una vez aprobado el presupuesto, se solicita pago de anticipo al menos 2 semanas antes del comienzo de la obra.",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface ObraItemInput {
  chapter: string;
  subChapter?: string | null;
  itemNumber: string;
  name: string;
  descriptionCliente: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  changeMarker?: "added" | "up" | "down" | null;
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

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

function fmtMoney(n: number): string {
  return "$ " + Math.round(n).toLocaleString("es-CL");
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}·${month}·${year}`;
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

// Isotipo "A" de marca (triángulo con barra) como SVG inline. Se usa como
// marca de agua (opacidad muy baja) y como sello chico en el encabezado del
// detalle. Reemplaza a assets/blarq-isotipo-piedra.png del diseño original.
function isotipo(px: number, color: string, opacity: number): string {
  return `<svg width="${px}" height="${px}" viewBox="0 0 100 100" style="opacity:${opacity};display:block;">
    <path d="M50 9 L91 91 L9 91 Z" fill="none" stroke="${color}" stroke-width="2"/>
    <line x1="34" y1="68" x2="66" y2="68" stroke="${color}" stroke-width="2"/>
  </svg>`;
}

// ─── CSS — paleta y tipografía del Manual v2 (Claro) ────────────────────────
// Colores exactos de la fuente de diseño:
//   Tinta #34332E · Grafito/valores #5f5b52 · Taupe/labels #9A9183
//   Piedra banda #6F6A60 · descripción #7a7468 · versión clara #b0a596
//   Banda/fila #EDEDEB · bordes #eee8dd (fila) #e2dcd0 (sección) #c7bfb2 (hairline)
const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Nunito Sans', sans-serif;
    color: #34332E;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* Los márgenes verticales (14mm) los pone el renderer en TODAS las páginas
     (route: margin top/bottom 14mm, left/right 0). Por eso acá el padding es
     solo lateral y la portada calcula su alto contra el área útil (297-28mm). */
  .page { position: relative; width: 210mm; overflow: hidden; }
  .page + .page { page-break-before: always; }
  .pad-cover { padding: 0 17mm; display: flex; flex-direction: column; justify-content: space-between; min-height: calc(297mm - 28mm); }
  .pad-detail { padding: 0 17mm; display: flex; flex-direction: column; }

  /* ── Portada ─────────────────────────────────────────────── */
  .wm { position: absolute; right: -20mm; bottom: -26mm; z-index: 0; }
  .cover-top, .cover-mid, .cover-foot { position: relative; z-index: 1; }
  .cover-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .cover-logo { width: 46mm; height: auto; }
  .cover-meta { text-align: right; font-family: 'Nunito Sans', sans-serif; }
  .cover-meta .m1 { font-size: 8.5pt; letter-spacing: .3em; text-transform: uppercase; color: #9A9183; font-weight: 600; }
  .cover-meta .m2 { font-size: 8.5pt; letter-spacing: .3em; text-transform: uppercase; color: #b0a596; font-weight: 600; margin-top: 4pt; }
  .cover-mid { display: flex; flex-direction: column; align-items: flex-start; gap: 6mm; }
  .cover-rule { width: 20mm; height: 1px; background: #c7bfb2; }
  .cover-title { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 34pt; line-height: 1.12; letter-spacing: .1em; text-transform: uppercase; color: #34332E; }
  .cover-sub { font-family: 'Spectral', serif; font-weight: 300; font-style: italic; font-size: 16pt; color: #9A9183; }
  .cover-foot { display: flex; flex-direction: column; gap: 4mm; font-family: 'Nunito Sans', sans-serif; border-top: 1px solid #e2dcd0; padding-top: 6mm; }
  .cover-foot .row { display: flex; justify-content: space-between; align-items: baseline; }
  .cover-foot .lbl { font-size: 8pt; letter-spacing: .16em; text-transform: uppercase; color: #9A9183; }
  .cover-foot .val { font-size: 10.5pt; color: #34332E; }

  /* ── Detalle: encabezado ─────────────────────────────────── */
  .dhead-iso { opacity: .55; margin-bottom: 7mm; }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; }
  .dhead .kick { font-size: 7.5pt; letter-spacing: .26em; text-transform: uppercase; color: #9A9183; font-weight: 600; }
  .dhead .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 18pt; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 3pt; }
  .dhead .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 9.5pt; color: #9A9183; margin-top: 3pt; }
  .dhead .right { text-align: right; }
  .dhead .ver { font-size: 7pt; letter-spacing: .28em; text-transform: uppercase; color: #b0a596; font-weight: 600; }
  .dhead .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 18pt; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 3pt; }
  .dhead .docsub { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 9pt; letter-spacing: .34em; text-transform: uppercase; color: #9A9183; margin-top: 3pt; }

  /* ── Tabla de partidas ───────────────────────────────────── */
  .grid { display: grid; grid-template-columns: 8% 24% 1fr 6% 7% 11% 13%; }
  .hd { border-bottom: 1.5px solid #34332E; padding: 7pt 0; margin-top: 8mm; font-size: 6.5pt; letter-spacing: .1em; text-transform: uppercase; color: #9A9183; font-weight: 700; }
  .hd span:nth-child(4){ text-align:center; } .hd span:nth-child(5),.hd span:nth-child(6),.hd span:nth-child(7){ text-align:right; }

  .cap { border-bottom: 1.5px solid #34332E; padding: 12pt 2pt 6pt; margin-top: 10pt; }
  .cap b { font-family: 'Hanken Grotesk', sans-serif; font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; color: #34332E; }

  .zone { background: #EDEDEB; padding: 4pt 10pt; margin-top: 4pt; font-size: 7pt; letter-spacing: .14em; text-transform: uppercase; color: #6F6A60; font-weight: 700; }

  .r { align-items: start; padding: 5pt 0; border-bottom: 1px solid #eee8dd; font-size: 8pt; page-break-inside: avoid; }
  .r span { line-height: 1.32; }
  .it { color: #9A9183; font-variant-numeric: tabular-nums; }
  .pt { color: #34332E; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; padding-right: 8pt; }
  .ds { color: #7a7468; padding-right: 10pt; }
  .un { text-align: center; color: #9A9183; }
  .ct { text-align: right; color: #5f5b52; font-variant-numeric: tabular-nums; }
  .pu { text-align: right; color: #5f5b52; font-variant-numeric: tabular-nums; }
  .tt { text-align: right; color: #34332E; font-variant-numeric: tabular-nums; }
  .ds p { margin: 0; } .ds ul { margin: 0; padding-left: 12px; } .ds ol { margin: 0; padding-left: 14px; }
  .ds strong { font-weight: 700; } .ds em { font-style: italic; }

  /* marca de cambio entre versiones */
  .chg { color: #34332E; font-weight: 700; }
  .chg-new { display:inline-block; border:0.5px solid #9A9183; border-radius:999px; padding:0 4px; font-size:5pt; letter-spacing:.04em; text-transform:uppercase; color:#6F6A60; }

  /* ── Cierre: formas de pago + cuadro ─────────────────────── */
  .cierre { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 12mm; align-items: start; page-break-inside: avoid; }
  .blk-title { font-family: 'Hanken Grotesk', sans-serif; font-size: 8.5pt; letter-spacing: .2em; text-transform: uppercase; color: #34332E; font-weight: 700; }
  .pagos { margin-top: 6pt; border-top: 1px solid #e2dcd0; }
  .pagos .row { display: flex; justify-content: space-between; align-items: baseline; padding: 6pt 0; border-bottom: 1px solid #eee8dd; }
  .pagos .row:last-child { border-bottom: none; }
  .pagos .s { font-size: 10pt; color: #34332E; }
  .pagos .p { font-size: 10pt; color: #6F6A60; font-weight: 700; font-variant-numeric: tabular-nums; }
  .cuadro { border-top: 1.5px solid #34332E; }
  .cuadro .row { display: grid; grid-template-columns: 1fr 34px 108px; align-items: baseline; padding: 4.5pt 0; border-bottom: 1px solid #e2dcd0; }
  .cuadro .cl { font-size: 9.5pt; color: #5f5b52; }
  .cuadro .cl.strong { color: #34332E; font-weight: 600; }
  .cuadro .cp { text-align: right; font-size: 8.5pt; color: #9A9183; font-variant-numeric: tabular-nums; }
  .cuadro .cv { text-align: right; font-size: 9.5pt; color: #5f5b52; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cuadro .cv.strong { color: #34332E; font-weight: 600; }
  .cuadro .row.grand { grid-template-columns: 1fr 130px; border-top: 1.5px solid #34332E; border-bottom: none; padding-top: 8pt; margin-top: 2pt; }
  .cuadro .row.grand .cl { font-family: 'Hanken Grotesk', sans-serif; font-size: 11pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #34332E; }
  .cuadro .row.grand .cv { font-size: 13pt; font-weight: 700; color: #34332E; }
  .iva-note { text-align: right; font-family: 'Spectral', serif; font-style: italic; font-size: 8pt; color: #9A9183; margin-top: 4pt; }

  /* ── Observaciones ───────────────────────────────────────── */
  .obs { margin-top: 12mm; page-break-inside: avoid; }
  .obs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5pt 14mm; margin-top: 7pt; }
  .obs-item { display: flex; gap: 8pt; font-size: 7.5pt; line-height: 1.4; color: #5f5b52; }
  .obs-num { color: #9A9183; font-variant-numeric: tabular-nums; flex-shrink: 0; }
`;

// ─── Renderer ─────────────────────────────────────────────────────────────
export function renderObraHTML(data: ObraHTMLInput): string {
  const { project, budget, items, paymentTerms } = data;
  const ggPct = budget.ggPercentage ?? 0;
  const utilPct = budget.utilityPercentage ?? 0;

  const costoDirecto = Math.round(items.reduce((s, i) => s + i.total, 0));
  const gg = Math.round(costoDirecto * (ggPct / 100));
  const utilidad = Math.round(costoDirecto * (utilPct / 100));
  const neto = costoDirecto + gg + utilidad;
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;

  // Agrupamos por zona (sub-capítulo) respetando el orden de llegada — que en
  // la app viene por sortOrder (Cocina antes que Baños, como en el diseño). NO
  // alfabetizamos: eso reordenaba las zonas (Baños antes que Cocina) y rompía
  // el orden del cuadro.
  const groupByZone = (chapterItems: ObraItemInput[]): ObraItemInput[] => {
    const zoneOrder: string[] = [];
    const buckets = new Map<string, ObraItemInput[]>();
    for (const it of chapterItems) {
      const z = it.subChapter ?? "";
      if (!buckets.has(z)) {
        buckets.set(z, []);
        zoneOrder.push(z);
      }
      buckets.get(z)!.push(it);
    }
    return zoneOrder.flatMap((z) => buckets.get(z)!);
  };

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: groupByZone(items.filter((i) => i.chapter === key)),
    }))
    .filter((ch) => ch.items.length > 0);

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);
  const versionLarga = `Versión ${budget.version.replace(/^V/i, "")} · ${dateStr}`;

  const logoHtml = logoUri
    ? `<img class="cover-logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="cover-logo" style="font-family:'Hanken Grotesk';font-size:24pt;letter-spacing:.15em;">BLARQ</div>`;

  const renderMarker = (m?: "added" | "up" | "down" | null) => {
    if (m === "up") return `<span class="chg">&#8593;</span> `;
    if (m === "down") return `<span class="chg">&#8595;</span> `;
    if (m === "added") return `<span class="chg-new">Nuevo</span> `;
    return "";
  };

  // Filas de la tabla. CORRECCIÓN MJ: sin subtotal de capítulo y sin monto de
  // zona — la banda de zona queda solo como separador.
  const tableRows = chapters
    .map((ch) => {
      const rows = ch.items
        .map((item, idx) => {
          const prev = idx > 0 ? ch.items[idx - 1] : null;
          const showZone =
            item.subChapter && (!prev || prev.subChapter !== item.subChapter);
          return `
          ${showZone ? `<div class="zone">${esc(item.subChapter!)}</div>` : ""}
          <div class="grid r">
            <span class="it">${renderMarker(item.changeMarker)}${ch.index}.${idx + 1}</span>
            <span class="pt">${esc(item.name)}</span>
            <span class="ds">${sanitizeRichTextHtml(item.descriptionCliente)}</span>
            <span class="un">${esc(item.unit)}</span>
            <span class="ct">${fmtQty(item.quantity)}</span>
            <span class="pu">${fmtNum(item.unitPrice)}</span>
            <span class="tt">${fmtMoney(item.total)}</span>
          </div>`;
        })
        .join("");
      return `
        <div class="cap"><b>${ch.index} · ${esc(ch.label)}</b></div>
        ${rows}`;
    })
    .join("");

  const detailHeader = `
    <div class="dhead-iso">${isotipo(40, "#9A9183", 0.55)}</div>
    <div class="dhead">
      <div>
        <div class="kick">Cotización de obra · detalle</div>
        <div class="proj">${esc(project.name)}</div>
        <div class="psub">${esc(project.clientName)} · Remodelación cocina y baños</div>
      </div>
      <div class="right">
        <div class="ver">${esc(versionLarga)}</div>
        <div class="doc">${esc(budget.version)} Cotización</div>
        <div class="docsub">Obra</div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} Cotización Obra — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600;700&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <!-- PORTADA -->
  <div class="page">
    <div class="wm">${isotipo(430, "#34332E", 0.06)}</div>
    <div class="pad-cover">
      <div class="cover-top">
        ${logoHtml}
        <div class="cover-meta">
          <div class="m1">Cotización · Obra</div>
          <div class="m2">${esc(versionLarga)}</div>
        </div>
      </div>
      <div class="cover-mid">
        <div class="cover-rule"></div>
        <div class="cover-title">Remodelación de<br/>cocina y baños</div>
        <div class="cover-sub">${esc(project.name)}${project.address ? " · " + esc(project.address) : ""}</div>
      </div>
      <div class="cover-foot">
        <div class="row"><span class="lbl">Mandante</span><span class="val">${esc(project.clientName)}</span></div>
        <div class="row"><span class="lbl">Profesional a cargo</span><span class="val">${esc(PROFESSIONAL)}</span></div>
      </div>
    </div>
  </div>

  <!-- DETALLE -->
  <div class="page">
    <div class="wm">${isotipo(290, "#34332E", 0.05)}</div>
    <div class="pad-detail">
      ${detailHeader}
      <div class="grid hd">
        <span>Ítem</span><span>Partida</span><span>Descripción</span>
        <span>Un</span><span>Cant</span><span>P. Unit.</span><span>Total</span>
      </div>
      ${tableRows}

      <div class="cierre">
        <div>
          <div class="blk-title">Formas de pago</div>
          <div class="pagos">
            ${terms
              .map(
                (t) => `<div class="row"><span class="s">${esc(t.stage)}</span><span class="p">${t.percentage}%</span></div>`
              )
              .join("")}
          </div>
        </div>
        <div>
          <div class="cuadro">
            <div class="row"><span class="cl">Costo directo</span><span class="cp"></span><span class="cv">${fmtMoney(costoDirecto)}</span></div>
            <div class="row"><span class="cl">Gastos generales</span><span class="cp">${ggPct}%</span><span class="cv">${fmtMoney(gg)}</span></div>
            <div class="row"><span class="cl">Utilidades</span><span class="cp">${utilPct}%</span><span class="cv">${fmtMoney(utilidad)}</span></div>
            <div class="row"><span class="cl strong">Costo neto</span><span class="cp"></span><span class="cv strong">${fmtMoney(neto)}</span></div>
            <div class="row"><span class="cl">IVA</span><span class="cp">19%</span><span class="cv">${fmtMoney(iva)}</span></div>
            <div class="row grand"><span class="cl">Costo total</span><span class="cv">${fmtMoney(total)}</span></div>
          </div>
          <div class="iva-note">Valor IVA incluido</div>
        </div>
      </div>

      <div class="obs">
        <div class="blk-title">Observaciones generales</div>
        <div class="obs-grid">
          ${OBSERVACIONES.map(
            (o, i) => `<div class="obs-item"><span class="obs-num">${i + 1}</span><span>${esc(o)}</span></div>`
          ).join("")}
        </div>
      </div>
    </div>
  </div>

</body>
</html>`;
}
