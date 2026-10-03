/**
 * Presupuesto de muebles al cliente: portada de marca v2 y detalle según el
 * diseño 2a de MJ (2026-10-03). Las medidas del original, 1240 px de ancho,
 * se trasladan a A4: 1 px del diseño equivale a 0,48 pt impresos.
 * El detalle fluye a más hojas cuando hace falta, sin recortar partidas.
 */

import fs from "node:fs";
import path from "node:path";
import { formatHerrajeName } from "@/lib/presupuesto/herrajeNombre";
import { renderCondicionesHTML } from "@/lib/pdf/condicionesBlock";
import type { Condicion } from "@/lib/presupuesto/condiciones";
import { soloLoQueCambia } from "@/lib/presupuesto/muebleItems";

const PROFESSIONAL = "MARÍA JOSÉ BLANCO";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Inicio instalación", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

// Las condiciones ya NO viven acá: son de la versión (`budget.conditions`) y
// se editan en la cotización. Ver lib/presupuesto/condiciones.ts.

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
  // Proveedor (y marca, si es de verdad) que ve el cliente, ya armado con
  // proveedorParaCliente: "DPH", "Blum · DPH". Opcional: las llamadas viejas
  // no lo pasan.
  brand?: string | null;
  // Familia del catálogo; nunca la ubicación interna del herraje.
  category?: string | null;
}

// Alternativa PARA EL CLIENTE de una partida (pendiente 177): el mismo mueble
// en otro material o con otras características, con su precio. Sale debajo de
// la partida base con la diferencia; NO suma en el subtotal ni en el total.
export interface MuebleAlternativaInput {
  name: string;
  descriptionGeneral: string | null;
  quantity: number;
  clientPriceIva: number;
  details: MuebleDetailInput[];
  herrajes?: MuebleHerrajeInput[];
}

export interface MuebleItemInput {
  itemNumber: string;
  name: string;
  descriptionGeneral: string | null;
  quantity: number;
  clientPriceIva: number;
  details: MuebleDetailInput[];
  herrajes?: MuebleHerrajeInput[];
  alternativas?: MuebleAlternativaInput[];
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
    // Condiciones de ESTA versión, en orden. Vacío → sin bloque de
    // observaciones en el PDF.
    conditions: Condicion[];
    coverTitle?: string | null;
    coverSubtitle?: string | null;
    coverNote?: string | null;
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

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

function fmtMoney(n: number): string {
  return "$ " + Math.round(n).toLocaleString("es-CL");
}

// Diferencia de una alternativa contra su base: signo siempre (el menos
// tipográfico alinea con el "+"), y el cero no se escribe. Del mismo gris en
// los dos sentidos: no es "bueno/malo", es una elección del cliente.
function fmtDiff(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "";
  return (r > 0 ? "+" : "−") + fmtMoney(Math.abs(r));
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}·${month}·${year}`;
}

function assetDataUri(file: string): string {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), "public", "assets", file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// ─── CSS — marca v2 (Claro), misma base que ObraPDF ─────────────────────────
const CSS = `
  @page { size: A4; margin: 8.47mm 0 7.79mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Nunito Sans', sans-serif;
    color: #36322C;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { position: relative; width: 210mm; overflow: hidden; }
  .page + .page { page-break-before: always; }
  .pad-cover { padding: 15mm 13.5mm; display: flex; flex-direction: column; justify-content: space-between; min-height: 297mm; }
  .detail-page { min-height: 280mm; }
  .pad-detail { position: relative; padding: 0 13.548mm; }
  .detail-page > .wm { right: -7.45mm; bottom: -11.85mm; }
  .detail-page > .wm img { width: 50.806mm; opacity: .05; }

  /* ── Portada — calibrada 1:1 al diseño de Claude Design, misma escala que Obra
       (logo 31mm tenue, título 25pt, meta/foot chicos, isotipo completo). ───── */
  /* El isotipo es una "A" (chevron + travesaño/"raya" a ~89% del alto): con
     bottom positivo el isotipo COMPLETO queda sobre la hoja; sangra a la derecha. */
  .wm { position: absolute; right: -6mm; bottom: 12mm; z-index: 0; }
  .cover-top, .cover-mid, .cover-foot { position: relative; z-index: 1; }
  .cover-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .cover-logo { width: 31mm; height: auto; opacity: .72; }
  .cover-meta { text-align: right; font-family: 'Nunito Sans', sans-serif; }
  .cover-meta .m1 { font-size: 6.2pt; letter-spacing: .3em; text-transform: uppercase; color: #9B9182; font-weight: 600; }
  .cover-meta .m2 { font-size: 6.2pt; letter-spacing: .3em; text-transform: uppercase; color: #ADA599; font-weight: 600; margin-top: 2.4pt; }
  .cover-mid { display: flex; flex-direction: column; align-items: flex-start; gap: 3.7mm; }
  .cover-rule { width: 12mm; height: 1px; background: #C4BEB5; }
  .cover-title { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 25pt; line-height: 1.12; letter-spacing: .12em; text-transform: uppercase; color: #36322C; max-width: 105mm; }
  .cover-sub { font-family: 'Spectral', serif; font-weight: 300; font-style: italic; font-size: 12pt; color: #9B9182; }
  .cover-foot { display: flex; flex-direction: column; gap: 2.7mm; font-family: 'Nunito Sans', sans-serif; border-top: 1px solid #DCDAD6; padding-top: 4mm; }
  .cover-foot .row { display: flex; justify-content: space-between; align-items: baseline; }
  .cover-foot .lbl { font-size: 5.8pt; letter-spacing: .16em; text-transform: uppercase; color: #9B9182; }
  .cover-foot .val { font-size: 7.2pt; color: #36322C; }

  /* Escala común: cantidad y total conservan la misma posición en todas
     las filas. La descripción absorbe los saltos de línea del contenido. */
  .pad-detail { --cols: 22.08pt minmax(0, 1fr) 33.6pt 62.4pt; --indent: 30.72pt; }
  .dhead-iso { width: 20.16pt; opacity: .55; margin-bottom: 14.4pt; display: block; }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; }
  .dhead > div { min-width: 0; }
  .dhead .kick { font-size: 5.28pt; letter-spacing: .26em; text-transform: uppercase; color: #9A9183; font-weight: 600; }
  .dhead .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 12.48pt; line-height: 1.2; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 2.88pt; }
  .dhead .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 6.72pt; color: #9A9183; margin-top: 1.92pt; }
  .dhead .right { text-align: right; flex-shrink: 0; max-width: 45%; }
  .dhead .ver { font-size: 4.8pt; letter-spacing: .28em; text-transform: uppercase; color: #b0a596; font-weight: 600; }
  .dhead .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 12.48pt; line-height: 1.2; letter-spacing: .05em; text-transform: uppercase; color: #34332E; margin-top: 2.88pt; }
  .dhead .docsub { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 6.24pt; letter-spacing: .34em; text-transform: uppercase; color: #9A9183; margin-top: 2.88pt; }

  .mhd { display: grid; grid-template-columns: var(--cols); padding: 3.84pt 0; border-bottom: .96pt solid #34332E; margin-top: 13.44pt; font-size: 4.32pt; letter-spacing: .1em; text-transform: uppercase; color: #9A9183; font-weight: 700; break-after: avoid; }
  .mhd .ct { text-align: center; } .mhd .rt { text-align: right; }
  .cap { background: #EDEDEB; padding: 3.84pt 6.72pt; margin-top: 4.8pt; font-size: 5.52pt; letter-spacing: .14em; text-transform: uppercase; break-inside: avoid; break-after: avoid; }
  .cap b { font-weight: 700; color: #34332E; }
  .partida { break-inside: avoid; }
  .mr { display: grid; grid-template-columns: var(--cols); align-items: baseline; font-size: 5.76pt; padding: 8.64pt 0 1.44pt; break-inside: avoid; break-after: avoid; }
  .cap + .partida .mr { padding-top: 5.76pt; }
  .mit { color: #9A9183; font-variant-numeric: tabular-nums; font-size: 5.76pt; }
  .mpt { color: #34332E; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 5.76pt; }
  .msub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; color: #9A9183; font-size: 6pt; display: block; margin-top: .96pt; }
  .mqty { text-align: center; color: #5f5b52; font-variant-numeric: tabular-nums; font-size: 5.76pt; }
  .mtt { text-align: right; color: #34332E; font-variant-numeric: tabular-nums; font-size: 6.24pt; font-weight: 700; white-space: nowrap; }

  .spec { margin: 1.92pt 0 1.92pt var(--indent); }
  .specrow, .hrow { display: grid; grid-template-columns: 81.6pt minmax(0, 1fr) 33.6pt 62.4pt; align-items: baseline; padding: 1.92pt 0; position: relative; border-bottom: .48pt solid transparent; font-size: 5.04pt; line-height: 1.35; color: #5f5b52; break-inside: avoid; }
  /* Chromium redondea los bordes subpíxel a 1 px. Escalamos el trazo para
     imprimir una línea realmente fina (0,25 pt), manteniendo el espaciado. */
  .specrow::after, .hrow::after, .pagos .row::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 1pt; background: #D0D0D0;
    transform: scaleY(.25); transform-origin: bottom;
  }
  .speclbl { letter-spacing: .04em; text-transform: uppercase; font-weight: 400; padding-right: 4pt; }
  .specval, .hname { min-width: 0; overflow-wrap: anywhere; }
  .speclbl:empty + .specval { grid-column: 1 / 3; }
  .hbrand, .hmut { color: #aaa294; font-weight: 400; }
  .hqty { text-align: center; color: #34332E; font-size: 5.28pt; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Alternativas elegidas por MJ: debajo de la base, sin banda, solo los
     componentes distintos. Precio y diferencia alineados a la derecha;
     nunca se incorporan a los totales del presupuesto. */
  .alts { margin-top: 5pt; }
  .alts-kick { display: block; margin-left: calc(4.5% + 25.1pt); font-family: 'Hanken Grotesk', sans-serif; font-size: 4.8pt; letter-spacing: .18em; text-transform: uppercase; color: #ADA599; font-weight: 400; padding-bottom: 1pt; border-bottom: 0.5px solid #E1DFDD; }
  /* Sin rayas entre alternativas: las separa el aire. El nombre y el precio
     son bloques con la misma altura de línea para que queden a la misma
     altura (inline, el nombre heredaba la línea del cuerpo y caía más abajo). */
  .alt { display: grid; grid-template-columns: 4.5% 1fr 13%; align-items: start; padding: 4pt 0 1pt; break-inside: avoid; }
  .alt-body { padding-left: 25.1pt; }
  .alt-name { display: block; line-height: 1.2; color: #8A8175; font-weight: 400; text-transform: uppercase; letter-spacing: .03em; font-size: 6.5pt; }
  .alt-body .msub { display: block; color: #ADA599; margin-top: 1pt; }
  .alt-body .spec { margin: 1.5pt 0 0; padding: 0; border-left: none; }
  .alt-body .specrow { grid-template-columns: 160.4pt 1fr; }
  .alt-body .speclbl { color: #9B9182; font-weight: 400; }
  .alt-body .specval { color: #9B9182; }
  .alt-igual { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 5.6pt; color: #ADA599; margin-top: 1pt; }
  .alt-price { text-align: right; color: #8A8175; font-variant-numeric: tabular-nums; font-size: 6.5pt; font-weight: 400; line-height: 1.2; }
  .alt-diff { text-align: right; color: #9B9182; font-variant-numeric: tabular-nums; font-size: 6pt; margin-top: 1pt; }
  .alt-note { display: grid; grid-template-columns: 4.5% 1fr; padding: 2pt 0 3pt; }
  .alt-note span { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 5.6pt; color: #ADA599; padding-left: 25.1pt; }

  /* Alternativas: conservan su diferencia de precio y quedan fuera del total. */
  .alts-kick { margin-left: var(--indent); }
  .alt { grid-template-columns: 22.08pt minmax(0, 1fr) 62.4pt; }
  .alt-body { padding-left: 8.64pt; }
  .alt-body .specrow { grid-template-columns: 81.6pt minmax(0, 1fr); }
  .alt-note { grid-template-columns: 22.08pt minmax(0, 1fr); }
  .alt-note span { padding-left: 8.64pt; }

  .cierre { display: grid; grid-template-columns: 1fr 1fr; gap: 23.04pt; margin-top: 17.28pt; align-items: start; break-inside: avoid; }
  .blk-title { font-size: 5.28pt; letter-spacing: .18em; text-transform: uppercase; color: #9A9183; font-weight: 700; }
  .pagos { margin-top: 4.8pt; border-top: .48pt solid #e2dcd0; }
  .pagos .row { display: flex; justify-content: space-between; gap: 8pt; padding: 3.84pt 0; position: relative; border-bottom: .48pt solid transparent; font-size: 6.72pt; }
  .pagos .p { color: #6F6A60; font-weight: 700; font-variant-numeric: tabular-nums; }
  .totalbox { border-top: .96pt solid #34332E; padding-top: 8.64pt; display: flex; flex-direction: column; align-items: flex-end; gap: 2.88pt; }
  .totalbox .totrow { display: flex; flex-direction: column; align-items: flex-end; gap: 2.88pt; }
  .totalbox .tl { font-size: 5.28pt; letter-spacing: .18em; text-transform: uppercase; color: #9A9183; font-weight: 700; }
  .totalbox .tv { font-variant-numeric: tabular-nums; font-size: 9.12pt; color: #34332E; font-weight: 600; }
  .totalbox .tn { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 6.24pt; color: #9A9183; text-align: right; }
  .obs { margin-top: 16.32pt; }
  .obs > .blk-title { break-after: avoid; }
  .obs-list { margin-top: 6.72pt; max-width: 441.6pt; }
  .obs-item { display: flex; gap: 5.76pt; font-size: 5.76pt; line-height: 1.45; color: #5f5b52; margin-top: 4.32pt; break-inside: avoid; }
  .obs-item:first-child { margin-top: 0; }
  .obs-num { color: #9A9183; font-variant-numeric: tabular-nums; flex-shrink: 0; font-weight: 600; }
  .obs-item b { color: #34332E; font-weight: 600; }
`;

// ─── Herrajes: familia · descripción · cantidad alineada con la partida ───
function renderHerrajes(herrajes?: MuebleHerrajeInput[]): string {
  if (!herrajes || herrajes.length === 0) return "";
  const labels: Record<string, string> = {
    cajon: "Correderas", corredera: "Correderas", bisagra: "Bisagras",
    despensa: "Accesorios", accesorio: "Accesorios", tirador: "Tiradores",
  };
  // Agrupamos solo productos idénticos salvo su medida y ubicación interna.
  // El nombre se conserva íntegro: una altura o modelo escritos allí nunca
  // se eliminan para forzar una coincidencia. Marca/proveedor y terminación
  // son parte de la identidad, aunque pertenezcan a la misma familia.
  const groups = new Map<string, Map<string, {
    item: MuebleHerrajeInput;
    quantity: number;
    measures: Map<string, number>;
  }>>();
  for (const h of herrajes) {
    const group = h.category ? (labels[h.category] ?? h.category) : "";
    let products = groups.get(group);
    if (!products) { products = new Map(); groups.set(group, products); }
    const key = JSON.stringify([h.name, h.brand ?? "", h.finish ?? "", h.category ?? ""]);
    let product = products.get(key);
    if (!product) {
      product = { item: h, quantity: 0, measures: new Map() };
      products.set(key, product);
    }
    product.quantity += h.quantity;
    const measure = h.measure?.trim() || "";
    product.measures.set(measure, (product.measures.get(measure) ?? 0) + h.quantity);
  }
  return Array.from(groups, ([group, products]) =>
    Array.from(products.values(), ({ item: h, quantity, measures }, index) => {
      const measureText = measures.size > 1
        ? Array.from(measures, ([measure, qty]) => `${measure || "Sin medida"} × ${fmtQty(qty)}`).join(" / ")
        : Array.from(measures.keys())[0];
      const spec = [measureText, h.finish].filter(Boolean).join(" · ");
      const mut = spec ? ` <span class="hmut">· ${esc(spec)}</span>` : "";
      const marca = h.brand ? ` <span class="hbrand">· ${esc(h.brand)}</span>` : "";
      return `<div class="hrow"><span class="speclbl">${index === 0 ? esc(group) : ""}</span><span class="hname">${esc(formatHerrajeName(h.name))}${marca}${mut}</span><span class="hqty">${fmtQty(quantity)} UN</span></div>`;
    }).join("")
  ).join("");
}

// Sub-líneas de materialidad (o líneas de herraje) de una partida o de una
// alternativa: es lo que el cliente compara.
function renderSpecBody(item: {
  details: MuebleDetailInput[];
  herrajes?: MuebleHerrajeInput[];
}): string {
  if (item.herrajes && item.herrajes.length > 0) return renderHerrajes(item.herrajes);
  return item.details
    .map(
      (d) => `<div class="specrow"><span class="speclbl">${esc(d.name)}</span><span class="specval">${esc(d.material)}</span></div>`
    )
    .join("");
}

function notaAlternativas(cantidad: number, numero: string): string {
  return cantidad === 1
    ? `No incluida en el total. Reemplaza a la partida ${numero} si se elige.`
    : `No incluidas en el total. Cada una reemplaza a la partida ${numero} si se elige.`;
}

// Las sub-líneas que cambian entre una alternativa y su base. Para una partida
// de herrajes (líneas de catálogo, sin sub-líneas) no hay comparación posible
// y se deja vacío: sale solo el nombre y el precio.
function cambiosDe(a: MuebleAlternativaInput, base: MuebleItemInput): MuebleDetailInput[] {
  return soloLoQueCambia(a.details, base.details);
}

// Lista de las alternativas de UNA partida base, debajo de su desglose: kicker
// una vez, y por alternativa el nombre, solo las sub-líneas que cambian, el
// precio y la diferencia. `numero` es el de la base ("1.1"), para decir a
// quién reemplaza. La nota va una sola vez por grupo.
function renderAlternativasLista(base: MuebleItemInput, numero: string): string {
  const alts = base.alternativas ?? [];
  if (alts.length === 0) return "";
  const baseTotal = base.clientPriceIva * base.quantity;
  const bloques = alts
    .map((a) => {
      const total = a.clientPriceIva * a.quantity;
      const diff = fmtDiff(total - baseTotal);
      const cambios = cambiosDe(a, base);
      const spec = cambios
        .map(
          (d) => `<div class="specrow"><span class="speclbl">${esc(d.name)}</span><span class="specval">${esc(d.material)}</span></div>`
        )
        .join("");
      const descripcion =
        a.descriptionGeneral && a.descriptionGeneral !== base.descriptionGeneral
          ? `<span class="msub">${esc(a.descriptionGeneral)}</span>`
          : "";
      const cuerpo = spec
        ? `<div class="spec">${spec}</div>`
        : base.details.length > 0
          ? `<div class="alt-igual">Misma materialidad que la partida cotizada.</div>`
          : "";
      return `
          <div class="alt">
            <span></span>
            <div class="alt-body">
              <span class="alt-name">${esc(a.name)}</span>${descripcion}
              ${cuerpo}
            </div>
            <div>
              <div class="alt-price">${fmtMoney(total)}</div>${diff ? `<div class="alt-diff">${diff}</div>` : ""}
            </div>
          </div>`;
    })
    .join("");
  return `
          <div class="alts">
            <span class="alts-kick">${alts.length === 1 ? "Alternativa" : "Alternativas"}</span>
            ${bloques}
            <div class="alt-note"><span></span><span>${notaAlternativas(alts.length, numero)}</span></div>
          </div>`;
}

// ─── HTML render ────────────────────────────────────────────────────────────
export function renderMueblesHTML(input: MueblesHTMLInput): string {
  const { project, budget, chapters, paymentTerms } = input;
  // El total sale de las partidas base: `alternativas` es
  // un campo aparte de cada partida y no entra en ninguna suma.
  const total = chapters
    .flatMap((c) => c.items)
    .reduce((sum, i) => sum + i.clientPriceIva * i.quantity, 0);

  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logo = assetDataUri("blarq-logo-horizontal-ink.png") || assetDataUri("logo-blarq.png");
  const iso = assetDataUri("blarq-isotipo-piedra.png");
  const dateStr = fmtDate(budget.date);
  const versionLarga = `Versión ${budget.version.replace(/^V/i, "")} · ${dateStr}`;

  const coverTitle = budget.coverTitle?.trim() || "Mobiliario a medida";
  const coverSubtitle =
    budget.coverSubtitle?.trim() ||
    `${project.name}${project.address ? " · " + project.address : ""}`;

  const logoHtml = logo
    ? `<img class="cover-logo" src="${logo}" alt="BLARQ" />`
    : `<div class="cover-logo" style="font-family:'Hanken Grotesk';font-size:24pt;letter-spacing:.15em;">BLARQ</div>`;
  const wm = iso ? `<img src="${iso}" style="width:78mm;opacity:.07;" />` : "";
  const dhIso = iso ? `<img class="dhead-iso" src="${iso}" alt="" />` : "";

  const tableRows = chapters
    .map((ch, chIdx) => {
      // Capítulo e ítem DERIVADOS por posición (lógica de prod): no confiamos en
      // ch.chapterNumber / item.itemNumber guardados (los Excel de origen a veces
      // tenían saltos o duplicados). Las partidas ya vienen ordenadas por
      // sortOrder desde la ruta — se muestran en secuencia, sin re-ordenar.
      const chapterNumber = chIdx + 1;
      const items = ch.items;
      const rows = items
        .map((item, itemIdx) => {
          const specBody = renderSpecBody(item);
          const numero = `${chapterNumber}.${itemIdx + 1}`;
          // Las alternativas van pegadas a su base (dentro del mismo bloque
          // `partida`, que no se parte entre páginas) para que se comparen
          // al lado.
          const altHtml = renderAlternativasLista(item, numero);
          return `
          <div class="partida">
            <div class="mr">
              <span class="mit">${numero}</span>
              <span><span class="mpt">${esc(item.name)}</span>${item.descriptionGeneral ? `<span class="msub">${esc(item.descriptionGeneral)}</span>` : ""}</span>
              <span class="mqty">${fmtQty(item.quantity)}</span>
              <span class="mtt">${fmtMoney(item.clientPriceIva * item.quantity)}</span>
            </div>
            ${specBody ? `<div class="spec">${specBody}</div>` : ""}
            ${altHtml}
          </div>`;
        })
        .join("");
      return `
        <div class="cap"><b>${chapterNumber} · ${esc(ch.name)}</b></div>
        ${rows}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} Cotización Muebles — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600;700&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <!-- PORTADA -->
  <div class="page">
    <div class="wm">${wm}</div>
    <div class="pad-cover">
      <div class="cover-top">
        ${logoHtml}
        <div class="cover-meta">
          <div class="m1">Cotización · Muebles</div>
          <div class="m2">${esc(versionLarga)}</div>
        </div>
      </div>
      <div class="cover-mid">
        <div class="cover-rule"></div>
        <div class="cover-title">${esc(coverTitle)}</div>
        <div class="cover-sub">${esc(coverSubtitle)}</div>
      </div>
      <div class="cover-foot">
        <div class="row"><span class="lbl">Mandante</span><span class="val">${esc(project.clientName)}</span></div>
        <div class="row"><span class="lbl">Profesional a cargo</span><span class="val">${esc(PROFESSIONAL)}</span></div>
      </div>
    </div>
  </div>

  <!-- DETALLE -->
  <div class="page detail-page">
    <div class="wm">${iso ? `<img src="${iso}" alt="" />` : ""}</div>
    <div class="pad-detail">
      ${dhIso}
      <div class="dhead">
        <div>
          <div class="kick">Cotización de muebles · detalle</div>
          <div class="proj">${esc(project.name)}</div>
          <div class="psub">${esc(project.clientName)} · ${esc(coverTitle)}</div>
        </div>
        <div class="right">
          <div class="ver">${esc(versionLarga)}</div>
          <div class="doc">${esc(budget.version)} Cotización</div>
          <div class="docsub">Muebles</div>
        </div>
      </div>
      <div class="mhd"><span>Ítem</span><span>Partida · Descripción</span><span class="ct">Cant</span><span class="rt">Total</span></div>
      ${tableRows}

      <div class="cierre">
        <div class="formas">
          <div class="blk-title">Formas de pago</div>
          <div class="pagos">
            ${terms
              .map(
                (t) => `<div class="row"><span class="s">${esc(t.stage)}</span><span class="p">${t.percentage}%</span></div>`
              )
              .join("")}
          </div>
        </div>
        <div class="totalbox">
          <div class="totrow"><span class="tl">Costo total muebles</span><span class="tv">${fmtMoney(total)}</span></div>
          <div class="tn">Valor IVA incluido</div>
        </div>
      </div>

      ${renderCondicionesHTML(budget.conditions, "obs-list")}
    </div>
  </div>

</body>
</html>`;
}
