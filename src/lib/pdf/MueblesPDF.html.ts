/**
 * HTML+CSS renderer del PDF de Muebles.
 * Consumido por renderPDF() (Puppeteer). Se renderiza a A4 con márgenes
 * verticales 14mm en TODAS las páginas (el route los pasa) para que la tabla,
 * que fluye entre páginas, no se corte contra el borde.
 *
 * Línea editorial: Manual de Marca BLARQ v2 (Claro). Fuente de verdad del
 * diseño: "Presupuesto Muebles Imprimible" de Claude Design. Hanken Grotesk
 * (títulos), Spectral (bajadas itálicas) y Nunito Sans (cuerpo y cifras).
 *
 * Corrección de MJ: la portada NO muestra "Inversión total". El resto del
 * diseño (subtotal por capítulo, "Valor IVA incluido", total) se mantiene.
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

// Cómo se muestran las alternativas. Los defaults son la forma elegida; las
// otras opciones existen para poder renderizar las variantes y comparar.
//   ubicacion: "bajo-partida" (lista bajo la partida: nombre, solo las
//              sub-líneas que cambian, precio y diferencia) | "cuadro" (un
//              cuadro comparativo bajo la partida: cotizada y alternativas en
//              columnas, una fila por componente que cambia) | "hoja-final"
//              (la lista, pero en una hoja "Alternativas" después del detalle).
//   precio:    "completo" (precio c/IVA + diferencia) | "diferencia" (solo la
//              diferencia contra la base).
export interface AlternativasOpciones {
  ubicacion?: "bajo-partida" | "cuadro" | "hoja-final";
  precio?: "completo" | "diferencia";
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
  alternativas?: AlternativasOpciones;
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
  @page { size: A4; margin: 14mm 0; }
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
  .page:first-child { overflow: visible; }
  .page + .page { page-break-before: always; }
  .pad-cover { padding: 15mm 13.5mm; display: flex; flex-direction: column; justify-content: space-between; min-height: 297mm; }
  .pad-detail { padding: 0 13mm; display: flex; flex-direction: column; }

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

  /* Detalle: encabezado */
  .dhead-iso { width: 40px; opacity: .55; margin-bottom: 7mm; display: block; }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; }
  .dhead .kick { font-size: 5.5pt; letter-spacing: .26em; text-transform: uppercase; color: #9B9182; font-weight: 600; }
  .dhead .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 15.5pt; line-height: 1.08; letter-spacing: .05em; text-transform: uppercase; color: #36322C; margin-top: 3pt; padding-right: 8mm; }
  .dhead .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 7pt; color: #9B9182; margin-top: 3pt; }
  .dhead .right { text-align: right; }
  .dhead .ver { font-size: 5.3pt; letter-spacing: .28em; text-transform: uppercase; color: #ADA599; font-weight: 600; }
  .dhead .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 13.5pt; line-height: 1.08; letter-spacing: .05em; text-transform: uppercase; color: #776E60; margin-top: 3pt; }
  /* Etiqueta del tipo (MUEBLES) en recuadro fino, para que se note. */
  .dhead .docsub { display: inline-block; font-family: 'Hanken Grotesk', sans-serif; font-weight: 500; font-size: 6.4pt; letter-spacing: .28em; text-transform: uppercase; color: #6C6B6B; margin-top: 5pt; border: 0.5px solid #B2ACA0; padding: 2.5pt 6pt 2.5pt 9pt; }

  /* Tabla */
  .mhd { display: grid; grid-template-columns: 4.5% 1fr 13%; padding: 3.5pt 0; border-bottom: 0.3px solid #9B9182; margin-top: 4mm; font-size: 5pt; letter-spacing: .1em; text-transform: uppercase; color: #9B9182; font-weight: 700; }
  .mhd .ct { text-align: center; } .mhd .rt { text-align: right; }

  /* Banda de capítulo: el subtotal se alinea a la MISMA columna que los totales
     de partida (borde derecho del contenido, padding-right 0) para que la plata
     forme una sola espina vertical. Número en ink + negrita, con etiqueta chica. */
  .cap { display: flex; justify-content: space-between; align-items: baseline; background: #EDECEB; padding: 4pt 0 4pt 10pt; margin-top: 5pt; break-inside: avoid; break-after: avoid; }
  .cap b { font-family: 'Hanken Grotesk', sans-serif; font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: #36322C; }
  .cap span { display: inline-flex; align-items: baseline; gap: 7pt; font-variant-numeric: tabular-nums; font-size: 8pt; color: #36322C; font-weight: 700; letter-spacing: .02em; }
  .cap span em { font-style: normal; font-family: 'Hanken Grotesk', sans-serif; font-size: 4.8pt; letter-spacing: .18em; text-transform: uppercase; color: #8A8175; font-weight: 700; }

  /* Cada partida (fila + su bloque de especificaciones/herrajes) se mantiene
     junta: no se separa el título de sus specs entre páginas. */
  .partida { break-inside: avoid; }
  .mr { display: grid; grid-template-columns: 4.5% 1fr 13%; align-items: baseline; padding: 3pt 0 1.5pt; border-top: 1px solid #E1DFDD; }
  .mit { color: #776E60; font-variant-numeric: tabular-nums; font-size: 6.5pt; }
  .mpt { color: #36322C; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; font-size: 7.5pt; }
  .msub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; color: #776E60; font-size: 5.7pt; display: block; margin-top: 2pt; }
  .mtt { text-align: right; color: #36322C; font-variant-numeric: tabular-nums; font-size: 7pt; font-weight: 700; }

  .spec { margin: 1pt 0 3pt 7%; padding: 1pt 0 1pt 12pt; border-left: 2px solid #E1DFDD; }
  .specrow { display: grid; grid-template-columns: 34% 1fr; padding: 0; font-size: 5.8pt; line-height: 1.08; }
  .speclbl { letter-spacing: .06em; text-transform: uppercase; color: #5C5449; font-weight: 700; }
  .specval { color: #625A4F; }
  .hrow { display: flex; justify-content: space-between; align-items: baseline; padding: 0.8pt 0; border-bottom: 1px solid #EBEAE9; font-size: 5.8pt; }
  .hrow:last-child { border-bottom: none; }
  .hname { color: #625A4F; }
  .hmut { color: #AAA194; }
  .hqty { color: #776E60; font-variant-numeric: tabular-nums; letter-spacing: .05em; flex-shrink: 0; padding-left: 14pt; }

  /* Alternativas para el cliente (pendiente 177). Sin raya ni fondo: lo que
     dice "cuelga de la partida de arriba" es la sangría (la MISMA del
     desglose: el nombre de la alternativa arranca donde arrancan los rótulos
     de las sub-líneas) y la tipografía un peldaño más chica y más clara. De
     la alternativa se listan SOLO las sub-líneas que cambian respecto de la
     base — el resto es idéntico. El precio cae en la misma espina vertical
     que los totales; la diferencia va del mismo gris sea + o −.
     Medidas en pt calibradas contra el PDF generado (rótulo del desglose en
     84,5pt, materialidad en 240,4pt): Chromium imprime los pt del CSS a
     ~0,972, por eso los valores no son redondos. */
  .alts { margin-top: 5pt; }
  .alts-kick { display: block; margin-left: calc(4.5% + 25.1pt); font-family: 'Hanken Grotesk', sans-serif; font-size: 4.8pt; letter-spacing: .18em; text-transform: uppercase; color: #8A8175; font-weight: 700; padding-bottom: 1pt; border-bottom: 0.5px solid #DCDAD6; margin-right: 0; }
  /* Sin rayas entre alternativas: las separa el aire. El nombre y el precio
     son bloques con la misma altura de línea para que queden a la misma
     altura (inline, el nombre heredaba la línea del cuerpo y caía más abajo). */
  .alt { display: grid; grid-template-columns: 4.5% 1fr 13%; align-items: start; padding: 4pt 0 1pt; break-inside: avoid; }
  .alt-body { padding-left: 25.1pt; }
  .alt-name { display: block; line-height: 1.2; color: #5C5449; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; font-size: 6.5pt; }
  .alt-body .msub { display: block; }
  .alt-body .msub { color: #8A8175; margin-top: 1pt; }
  .alt-body .spec { margin: 1.5pt 0 0; padding: 0; border-left: none; }
  .alt-body .specrow { grid-template-columns: 160.4pt 1fr; }
  .alt-body .speclbl { color: #776E60; }
  .alt-body .specval { color: #625A4F; }
  .alt-igual { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 5.6pt; color: #8A8175; margin-top: 1pt; }
  .alt-price { text-align: right; color: #5C5449; font-variant-numeric: tabular-nums; font-size: 6.5pt; font-weight: 700; line-height: 1.2; }
  .alt-diff { text-align: right; color: #8A8175; font-variant-numeric: tabular-nums; font-size: 6pt; margin-top: 1pt; }
  .alt-diff.solo { font-size: 6.5pt; color: #5C5449; font-weight: 700; margin-top: 0; }
  .alt-note { display: grid; grid-template-columns: 4.5% 1fr; padding: 2pt 0 3pt; }
  .alt-note span { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 5.6pt; color: #8A8175; padding-left: 25.1pt; }

  /* Variante CUADRO: cotizada y alternativas en columnas, una fila por
     componente que cambia, y al pie el total y la diferencia de cada una.
     Misma sangría que el desglose; la primera columna (el componente) tiene el
     ancho del rótulo del desglose para que las materialidades caigan donde
     caen las de la partida. */
  .cmp { margin: 5pt 0 3pt calc(4.5% + 25.1pt); break-inside: avoid; }
  .cmp table { width: 100%; border-collapse: collapse; font-size: 5.8pt; line-height: 1.15; table-layout: fixed; }
  .cmp th { text-align: left; font-family: 'Hanken Grotesk', sans-serif; font-size: 4.8pt; letter-spacing: .18em; text-transform: uppercase; color: #8A8175; font-weight: 700; padding: 0 8pt 2pt 0; border-bottom: 0.5px solid #C2BCB4; vertical-align: bottom; }
  .cmp th .nm { display: block; font-family: 'Nunito Sans', sans-serif; font-size: 6.2pt; letter-spacing: .03em; color: #5C5449; margin-top: 1.5pt; font-weight: 700; }
  .cmp th.lbl, .cmp td.lbl { width: 160.4pt; }
  .cmp td { padding: 1.8pt 8pt 1.8pt 0; vertical-align: top; color: #625A4F; border-bottom: 1px solid #EBEAE9; }
  .cmp td.lbl { letter-spacing: .06em; text-transform: uppercase; color: #5C5449; font-weight: 700; }
  .cmp tr.tot td { border-bottom: none; padding-top: 3pt; padding-bottom: 0; font-weight: 700; color: #36322C; font-variant-numeric: tabular-nums; }
  .cmp tr.tot td.lbl { color: #8A8175; font-weight: 700; }
  .cmp tr.dif td { border-bottom: none; padding-top: 0.5pt; color: #8A8175; font-variant-numeric: tabular-nums; }
  .cmp tr.dif td.lbl { color: #8A8175; font-weight: 700; }
  .cmp-note { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 5.6pt; color: #8A8175; margin-top: 2.5pt; }

  /* Hoja "Alternativas" al final (variante). La partida base va como
     referencia en su fila normal y sus alternativas debajo. */
  .althoja-ref { display: grid; grid-template-columns: 4.5% 1fr 13%; align-items: baseline; padding: 4pt 0 1.5pt; border-top: 1px solid #E1DFDD; margin-top: 4pt; }
  .althoja-ref .mtt { color: #776E60; font-weight: 400; }
  .althoja-ref .mpt { color: #5C5449; }
  .althoja-ref .msub { margin-top: 1pt; }

  /* Cierre */
  .cierre { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 4mm; align-items: start; break-inside: avoid; }
  .blk-title { font-family: 'Hanken Grotesk', sans-serif; font-size: 7pt; letter-spacing: .2em; text-transform: uppercase; color: #36322C; font-weight: 400; border-bottom: 0.6px solid #C2BCB4; padding-bottom: 2.5pt; }
  /* Formas de pago: formato ÚNICO en los 3 PDF (corrección MJ) — 5,6pt. */
  .pagos { margin-top: 5pt; border-top: 1px solid #DCDAD6; }
  .pagos .row { display: flex; justify-content: space-between; align-items: baseline; padding: 2pt 0; border-bottom: 1px solid #E7E6E4; }
  .pagos .row:last-child { border-bottom: none; }
  .pagos .s { font-size: 5.6pt; color: #36322C; }
  .pagos .p { font-size: 5.6pt; color: #736A5C; font-weight: 700; font-variant-numeric: tabular-nums; }
  .formas .blk-title { font-size: 5.6pt; padding-bottom: 2pt; }
  /* Costo total: mismo trato que el total de ambiente de Artefactos — fila en
     negrita con línea negra ABAJO (no arriba), sin número gigante. */
  .totalbox { display: flex; flex-direction: column; }
  .totalbox .totrow { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #36322C; padding: 5pt 0 3pt; }
  .totalbox .tl { font-family: 'Hanken Grotesk', sans-serif; font-size: 8.5pt; letter-spacing: .2em; text-transform: uppercase; color: #36322C; font-weight: 700; }
  .totalbox .tv { font-variant-numeric: tabular-nums; font-size: 8.5pt; color: #36322C; font-weight: 700; }
  .totalbox .tn { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 7.5pt; color: #78716A; text-align: right; margin-top: 3pt; }

  /* Observaciones */
  .obs { margin-top: 2.5mm; break-inside: avoid; }
  .obs-list { display: flex; flex-direction: column; gap: 1.8pt; margin-top: 3pt; }
  .obs-item { display: flex; gap: 8pt; font-size: 6.3pt; line-height: 1.22; color: #6C6B6B; }
  .obs-num { color: #948E85; font-variant-numeric: tabular-nums; flex-shrink: 0; font-weight: 600; }
  .obs-item b { color: #4A4843; font-weight: 600; }
`;

// ─── Render herrajes (lista plana: nombre · medida/color · cantidad) ────────
function renderHerrajes(herrajes?: MuebleHerrajeInput[]): string {
  if (!herrajes || herrajes.length === 0) return "";
  return herrajes
    .map((h) => {
      const spec = [h.measure, h.finish].filter(Boolean).join(" · ");
      const mut = spec ? ` <span class="hmut">· ${esc(spec)}</span>` : "";
      // Nombre con la escritura homologada (pendiente 139) — el mismo helper
      // que usa el editor, para que el PDF y la pantalla no puedan divergir.
      return `<div class="hrow"><span class="hname">${esc(formatHerrajeName(h.name))}${mut}</span><span class="hqty">${fmtQty(h.quantity)} UN</span></div>`;
    })
    .join("");
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
function renderAlternativasLista(
  base: MuebleItemInput,
  numero: string,
  precio: NonNullable<AlternativasOpciones["precio"]>,
): string {
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
      const precioHtml =
        precio === "diferencia"
          ? `<div class="alt-diff solo">${diff || fmtMoney(0)}</div>`
          : `<div class="alt-price">${fmtMoney(total)}</div>${diff ? `<div class="alt-diff">${diff}</div>` : ""}`;
      return `
          <div class="alt">
            <span></span>
            <div class="alt-body">
              <span class="alt-name">${esc(a.name)}</span>${descripcion}
              ${cuerpo}
            </div>
            <div>${precioHtml}</div>
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

// Cuadro comparativo: la partida cotizada y sus alternativas en columnas, una
// fila por componente que cambia en alguna de ellas (en el orden del desglose
// de la base; los componentes nuevos, al final), y al pie el total y la
// diferencia. Es la forma en que un cliente compara materiales: renglón a
// renglón, de un vistazo.
function renderAlternativasCuadro(
  base: MuebleItemInput,
  numero: string,
  precio: NonNullable<AlternativasOpciones["precio"]>,
): string {
  const alts = base.alternativas ?? [];
  if (alts.length === 0) return "";
  const baseTotal = base.clientPriceIva * base.quantity;

  // Filas: unión de los componentes que cambian, con la clave normalizada.
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  const filas: string[] = [];
  const vistas = new Set<string>();
  const agregar = (nombre: string) => {
    const k = norm(nombre);
    if (!vistas.has(k)) {
      vistas.add(k);
      filas.push(nombre);
    }
  };
  for (const d of base.details) {
    if (alts.some((a) => cambiosDe(a, base).some((c) => norm(c.name) === norm(d.name)))) agregar(d.name);
  }
  for (const a of alts) for (const c of cambiosDe(a, base)) agregar(c.name);

  const materialDe = (item: { details: MuebleDetailInput[] }, nombre: string) =>
    item.details.find((d) => norm(d.name) === norm(nombre))?.material ?? "—";

  const cabecera = `
              <tr>
                <th class="lbl"></th>
                <th>Cotizada<span class="nm">${esc(base.name)}</span></th>
                ${alts.map((a) => `<th>Alternativa<span class="nm">${esc(a.name)}</span></th>`).join("")}
              </tr>`;
  const cuerpo =
    filas.length > 0
      ? filas
          .map(
            (f) => `
              <tr>
                <td class="lbl">${esc(f)}</td>
                <td>${esc(materialDe(base, f))}</td>
                ${alts.map((a) => `<td>${esc(materialDe(a, f))}</td>`).join("")}
              </tr>`
          )
          .join("")
      : `
              <tr>
                <td class="lbl"></td>
                <td colspan="${alts.length + 1}"><span class="alt-igual">Misma materialidad que la partida cotizada.</span></td>
              </tr>`;
  const totales =
    precio === "diferencia"
      ? `
              <tr class="tot">
                <td class="lbl">Diferencia</td>
                <td>—</td>
                ${alts.map((a) => `<td>${fmtDiff(a.clientPriceIva * a.quantity - baseTotal) || fmtMoney(0)}</td>`).join("")}
              </tr>`
      : `
              <tr class="tot">
                <td class="lbl">Total</td>
                <td>${fmtMoney(baseTotal)}</td>
                ${alts.map((a) => `<td>${fmtMoney(a.clientPriceIva * a.quantity)}</td>`).join("")}
              </tr>
              <tr class="dif">
                <td class="lbl">Diferencia</td>
                <td>—</td>
                ${alts.map((a) => `<td>${fmtDiff(a.clientPriceIva * a.quantity - baseTotal) || "—"}</td>`).join("")}
              </tr>`;
  return `
          <div class="cmp">
            <table>
              <thead>${cabecera}</thead>
              <tbody>${cuerpo}${totales}</tbody>
            </table>
            <div class="cmp-note">${notaAlternativas(alts.length, numero)}</div>
          </div>`;
}

// ─── HTML render ────────────────────────────────────────────────────────────
export function renderMueblesHTML(input: MueblesHTMLInput): string {
  const { project, budget, chapters, paymentTerms } = input;
  const altUbicacion = input.alternativas?.ubicacion ?? "bajo-partida";
  const altPrecio = input.alternativas?.precio ?? "completo";

  // El total y los subtotales salen de las partidas base: `alternativas` es
  // un campo aparte de cada partida y no entra en ninguna suma.
  const total = chapters
    .flatMap((c) => c.items)
    .reduce((sum, i) => sum + i.clientPriceIva * i.quantity, 0);

  // Para la variante "hoja al final": las partidas con alternativas, con su
  // número derivado, en el orden del documento.
  const conAlternativas: { numero: string; item: MuebleItemInput }[] = [];

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
      const subtotal = items.reduce((s, i) => s + i.clientPriceIva * i.quantity, 0);
      const rows = items
        .map((item, itemIdx) => {
          const specBody = renderSpecBody(item);
          const numero = `${chapterNumber}.${itemIdx + 1}`;
          if ((item.alternativas?.length ?? 0) > 0) {
            conAlternativas.push({ numero, item });
          }
          // Las alternativas van pegadas a su base (dentro del mismo bloque
          // `partida`, que no se parte entre páginas) para que se comparen
          // al lado. En la variante "hoja al final" acá no sale nada.
          const altHtml =
            altUbicacion === "bajo-partida"
              ? renderAlternativasLista(item, numero, altPrecio)
              : altUbicacion === "cuadro"
                ? renderAlternativasCuadro(item, numero, altPrecio)
                : "";
          return `
          <div class="partida">
            <div class="mr">
              <span class="mit">${numero}</span>
              <span><span class="mpt">${esc(item.name)}</span>${item.descriptionGeneral ? `<span class="msub">${esc(item.descriptionGeneral)}</span>` : ""}</span>
              <span class="mtt">${fmtMoney(item.clientPriceIva * item.quantity)}</span>
            </div>
            ${specBody ? `<div class="spec">${specBody}</div>` : ""}
            ${altHtml}
          </div>`;
        })
        .join("");
      return `
        <div class="cap"><b>${chapterNumber} · ${esc(ch.name)}</b><span><em>Subtotal</em>${fmtMoney(subtotal)}</span></div>
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
  <div class="page">
    <div class="wm">${iso ? `<img src="${iso}" style="width:70mm;opacity:.06;" />` : ""}</div>
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
      <div class="mhd"><span>Ítem</span><span>Partida · Descripción</span><span class="rt">Total</span></div>
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
  ${altUbicacion === "hoja-final" && conAlternativas.length > 0 ? `
  <!-- ALTERNATIVAS (variante: hoja aparte al final) -->
  <div class="page">
    <div class="wm">${iso ? `<img src="${iso}" style="width:70mm;opacity:.06;" />` : ""}</div>
    <div class="pad-detail">
      ${dhIso}
      <div class="dhead">
        <div>
          <div class="kick">Cotización de muebles · alternativas</div>
          <div class="proj">${esc(project.name)}</div>
          <div class="psub">Opciones no incluidas en el total. Cada una reemplaza a la partida indicada si se elige.</div>
        </div>
        <div class="right">
          <div class="ver">${esc(versionLarga)}</div>
          <div class="doc">${esc(budget.version)} Cotización</div>
          <div class="docsub">Alternativas</div>
        </div>
      </div>
      <div class="mhd"><span>Ítem</span><span>Partida · Alternativa</span><span class="rt">Total</span></div>
      ${conAlternativas
        .map(
          ({ numero, item }) => `
      <div class="partida">
        <div class="althoja-ref">
          <span class="mit">${numero}</span>
          <span><span class="mpt">${esc(item.name)}</span><span class="msub">Partida cotizada</span></span>
          <span class="mtt">${fmtMoney(item.clientPriceIva * item.quantity)}</span>
        </div>
        ${renderAlternativasLista(item, numero, altPrecio)}
      </div>`,
        )
        .join("")}
    </div>
  </div>` : ""}

</body>
</html>`;
}
