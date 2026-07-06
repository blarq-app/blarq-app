/**
 * HTML+CSS renderer del PDF de Artefactos.
 * Consumido por renderPDF() (Puppeteer). A4 con márgenes verticales 14mm en
 * todas las páginas (el route los pasa) para que la tabla no se corte.
 *
 * Línea editorial: Manual de Marca BLARQ v2 (Claro). Fuente de verdad del
 * diseño: "Presupuesto Artefactos Imprimible" de Claude Design. Hanken Grotesk
 * (títulos), Spectral (bajadas itálicas), Nunito Sans (cuerpo/cifras).
 *
 * Correcciones de MJ sobre el diseño:
 *   - Portada SIN "Inversión total".
 *   - Letras de la tabla en tono oscuro (Grafito), no greige claro que
 *     "desaparecía" (línea/color/detalle/marca/precio lista).
 *   - Totales por ambiente ("Total artefactos baño X") más visibles.
 *   - Imágenes de producto grandes (como el PDF que ya salía de la app).
 *   - "Valor IVA incluido" bajo el total (el diseño ya lo trae).
 *
 * NOTA: el costo interno BLARQ (NETO, utilidad) NUNCA va al PDF del cliente.
 */

import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "MARÍA JOSÉ BLANCO";

const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 60 },
  { stage: "Despacho", percentage: 30 },
  { stage: "Saldo", percentage: 10 },
];

const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};
const ROOM_ORDER = ["bano_principal", "bano_secundario", "bano_visita", "cocina", "lavadero", "otro"];

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Artefactos sanitarios",
  cocina: "Artefactos cocina",
  iluminacion: "Artefactos iluminación",
};
const SUBCATEGORY_ORDER = ["sanitario", "cocina", "iluminacion"];

const OBSERVACIONES = [
  "Los artefactos cotizados están sujetos a disponibilidad de stock al momento del pago del anticipo.",
  "Los descuentos aplicados son sobre precio lista del proveedor y válidos solo para esta cotización.",
  "Tiempo de despacho: 7 a 15 días hábiles tras el pago del anticipo, dependiendo del proveedor.",
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
  discountPercent: number | null; // decimal 0..1
  clientPrice: number; // unitario
  imageUrl: string | null;
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
    clientPhone: string | null;
    ufReference: number | null;
  };
  budget: {
    version: string;
    date: string | Date;
    observations: string | null;
    coverTitle?: string | null;
    coverSubtitle?: string | null;
    coverNote?: string | null;
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

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}
function fmtMoney(n: number): string {
  return "$ " + Math.round(n).toLocaleString("es-CL");
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
  const year = String(date.getUTCFullYear());
  return `${day}·${month}·${year}`;
}

// Línea y color derivados del nombre (espejo del editor). En MAYÚSCULA.
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

function assetDataUri(file: string): string {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), "public", "assets", file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// ─── CSS — marca v2 (Claro) ─────────────────────────────────────────────────
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
  /* Padding lateral más ajustado que obra/muebles: la tabla tiene 10 columnas
     + imágenes grandes, necesita ancho. */
  .pad-detail { padding: 0 11mm; display: flex; flex-direction: column; }

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

  .dhead-iso { width: 40px; opacity: .55; margin-bottom: 7mm; display: block; }
  .dhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2mm; }
  .dhead .kick { font-size: 5.5pt; letter-spacing: .26em; text-transform: uppercase; color: #9B9182; font-weight: 600; }
  .dhead .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 15.5pt; line-height: 1.08; letter-spacing: .05em; text-transform: uppercase; color: #36322C; margin-top: 3pt; padding-right: 8mm; }
  .dhead .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 7pt; color: #9B9182; margin-top: 3pt; }
  .dhead .right { text-align: right; }
  .dhead .ver { font-size: 5pt; letter-spacing: .28em; text-transform: uppercase; color: #ADA599; font-weight: 600; }
  .dhead .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 10pt; letter-spacing: .05em; text-transform: uppercase; color: #776E60; margin-top: 3pt; }
  .dhead .docsub { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 6.5pt; letter-spacing: .34em; text-transform: uppercase; color: #9B9182; margin-top: 3pt; }

  /* Banda de subcategoría (piedra) y de ambiente (banda gris) */
  .band { display: flex; align-items: center; background: #736A5C; padding: 6pt 12pt; margin-top: 10pt; break-inside: avoid; break-after: avoid; }
  .band span { font-size: 7pt; letter-spacing: .22em; text-transform: uppercase; color: #F3F3F3; font-weight: 700; }
  .grp { display: flex; align-items: center; background: #EDECEB; padding: 4pt 12pt; margin-top: 8pt; break-inside: avoid; break-after: avoid; }
  .grp span { font-size: 6pt; letter-spacing: .2em; text-transform: uppercase; color: #736A5C; font-weight: 700; }

  /* Tabla 10 columnas. Foto ancha para imagen grande (correción MJ). */
  .ahd, .ar { display: grid; grid-template-columns: 34mm 14% 7% 7% 1fr 8% 4% 9% 5% 11%; gap: 0 5pt; }
  .ahd { padding: 5pt 3pt; border-bottom: 0.3px solid #9B9182; font-size: 5pt; letter-spacing: .1em; text-transform: uppercase; color: #9B9182; font-weight: 700; break-inside: avoid; break-after: avoid; margin-top: 2pt; }
  .ahd .c { text-align: center; } .ahd .r { text-align: right; }
  .ar { align-items: center; padding: 3.5pt 3pt; border-bottom: 1px solid #E7E6E4; font-size: 6pt; line-height: 1.3; break-inside: avoid; }
  .ar .foto { width: 34mm; }
  .ar .foto img { max-width: 32mm; max-height: 32mm; object-fit: contain; display: block; }
  .ar .foto .ph { width: 32mm; height: 32mm; background: #F3F3F3; border: 1px solid #E1DFDD; }
  /* Texto oscuro (Grafito) — corrección MJ: que no "desaparezca". */
  .a-it { color: #36322C; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; font-size: 6pt; }
  .a-ln { color: #36322C; text-transform: uppercase; letter-spacing: .04em; font-size: 6.5pt; }
  .a-co { color: #36322C; font-size: 6.5pt; }
  .a-de { color: #36322C; font-size: 6.5pt; }
  .a-ma { color: #36322C; font-size: 6.5pt; }
  .a-ct { text-align: center; color: #36322C; font-variant-numeric: tabular-nums; }
  .a-pl { text-align: right; color: #36322C; font-variant-numeric: tabular-nums; }
  .a-dc { text-align: right; color: #9B9182; font-variant-numeric: tabular-nums; }
  .a-dc.on { color: #8a7f54; font-weight: 700; }
  .a-tt { text-align: right; color: #36322C; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* Total por ambiente — más visible (corrección MJ): banda bruma + valor
     Tinta bold, no la itálica tenue original. */
  .gtot { display: flex; justify-content: space-between; align-items: baseline; padding: 6pt 12pt; margin-top: 3pt; background: #EDECEB; break-inside: avoid; }
  .gtot .lbl { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: #736A5C; font-weight: 700; }
  .gtot .val { font-variant-numeric: tabular-nums; font-size: 11pt; color: #36322C; font-weight: 700; }

  /* Cierre: forma de pago + resumen por subcategoría + total */
  .cierre { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 10mm; align-items: start; break-inside: avoid; }
  .blk-title { font-family: 'Hanken Grotesk', sans-serif; font-size: 8.5pt; letter-spacing: .2em; text-transform: uppercase; color: #36322C; font-weight: 700; }
  .pagos { margin-top: 6pt; border-top: 1px solid #DCDAD6; }
  .pagos .row { display: flex; justify-content: space-between; align-items: baseline; padding: 6pt 0; border-bottom: 1px solid #E7E6E4; }
  .pagos .row:last-child { border-bottom: none; }
  .pagos .s { font-size: 10pt; color: #36322C; }
  .pagos .p { font-size: 10pt; color: #736A5C; font-weight: 700; font-variant-numeric: tabular-nums; }
  .resumen { border-top: 2px solid #36322C; padding-top: 8pt; }
  .resumen .row { display: flex; justify-content: space-between; align-items: baseline; padding: 4pt 0; border-bottom: 1px solid #DCDAD6; }
  .resumen .rl { font-size: 9pt; color: #625A4F; }
  .resumen .rv { font-size: 9pt; color: #625A4F; font-variant-numeric: tabular-nums; }
  .resumen .grand { display: flex; justify-content: space-between; align-items: baseline; padding: 8pt 0 0; margin-top: 2pt; border-top: 2px solid #36322C; }
  .resumen .grand .gl { font-size: 10pt; color: #36322C; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .resumen .grand .gv { font-size: 14pt; color: #36322C; font-weight: 700; font-variant-numeric: tabular-nums; }
  .iva-note { text-align: right; font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 8pt; color: #9B9182; margin-top: 4pt; }

  .obs { margin-top: 12mm; break-inside: avoid; }
  .obs-list { display: flex; flex-direction: column; gap: 5pt; margin-top: 7pt; }
  .obs-item { display: flex; gap: 8pt; font-size: 7.5pt; line-height: 1.45; color: #625A4F; }
  .obs-num { color: #9B9182; font-variant-numeric: tabular-nums; flex-shrink: 0; font-weight: 600; }
`;

// ─── HTML render ────────────────────────────────────────────────────────────
export function renderArtefactosHTML(input: ArtefactosHTMLInput): string {
  const { project, budget, items, paymentTerms } = input;

  type RoomGroup = { key: string; label: string; items: ArtefactoItemInput[]; subtotal: number };
  type SubcatGroup = { key: string; label: string; rooms: RoomGroup[]; subtotal: number };

  const subcatBuckets = new Map<string, ArtefactoItemInput[]>();
  for (const it of items) {
    const key = it.subcategory || "sanitario";
    const arr = subcatBuckets.get(key) ?? [];
    arr.push(it);
    subcatBuckets.set(key, arr);
  }
  const subcatKeysSorted = Array.from(subcatBuckets.keys()).sort((a, b) => {
    const ia = SUBCATEGORY_ORDER.indexOf(a);
    const ib = SUBCATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const orderedSubcats: SubcatGroup[] = subcatKeysSorted.map((subKey) => {
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
      const subtotal = rItems.reduce((s, it) => s + it.clientPrice * it.quantity, 0);
      return { key: rkey, label: ROOM_LABELS[rkey] ?? rkey, items: rItems, subtotal };
    });
    const subtotal = rooms.reduce((s, r) => s + r.subtotal, 0);
    return { key: subKey, label: SUBCATEGORY_LABELS[subKey] ?? subKey, rooms, subtotal };
  });

  const totalCliente = items.reduce((sum, i) => sum + i.clientPrice * i.quantity, 0);
  const terms = paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  const logo = assetDataUri("blarq-logo-horizontal-ink.png") || assetDataUri("logo-blarq.png");
  const iso = assetDataUri("blarq-isotipo-piedra.png");
  const dateStr = fmtDate(budget.date);
  const versionLarga = `Versión ${budget.version.replace(/^V/i, "")} · ${dateStr}`;

  const coverTitle = budget.coverTitle?.trim() || "Artefactos y equipamiento";
  const coverSubtitle =
    budget.coverSubtitle?.trim() ||
    `${project.name}${project.address ? " · " + project.address : ""}`;

  const logoHtml = logo
    ? `<img class="cover-logo" src="${logo}" alt="BLARQ" />`
    : `<div class="cover-logo" style="font-family:'Hanken Grotesk';font-size:24pt;letter-spacing:.15em;">BLARQ</div>`;
  const dhIso = iso ? `<img class="dhead-iso" src="${iso}" alt="" />` : "";

  const colHeader = `<div class="ahd"><span>Foto</span><span>Ítem</span><span>Línea</span><span>Color</span><span>Detalle</span><span>Marca</span><span class="c">Cant</span><span class="r">P. lista</span><span class="r">Dcto</span><span class="r">Total</span></div>`;

  const sections = orderedSubcats
    .map((sub) => {
      const roomsHtml = sub.rooms
        .map((r) => {
          const rows = r.items
            .map((it) => {
              const dcOn = it.discountPercent && it.discountPercent > 0 ? " on" : "";
              const img = it.imageUrl
                ? `<img src="${esc(it.imageUrl)}" alt="" />`
                : `<div class="ph"></div>`;
              return `<div class="ar">
                <span class="foto">${img}</span>
                <span class="a-it">${esc(it.name)}</span>
                <span class="a-ln">${esc(lineaDe(it.name, it.detail) || "—")}</span>
                <span class="a-co">${esc(colorDe(it.name, it.detail) || "—")}</span>
                <span class="a-de">${esc(it.detail || "")}</span>
                <span class="a-ma">${esc(it.brand || "—")}</span>
                <span class="a-ct">${it.quantity}</span>
                <span class="a-pl">${it.listPrice > 0 ? fmtNum(it.listPrice) : "—"}</span>
                <span class="a-dc${dcOn}">${fmtPct(it.discountPercent)}</span>
                <span class="a-tt">${fmtMoney(it.clientPrice * it.quantity)}</span>
              </div>`;
            })
            .join("");
          return `
            <div class="grp"><span>${esc(r.label)}</span></div>
            ${colHeader}
            ${rows}
            <div class="gtot"><span class="lbl">Total artefactos ${esc(r.label.toLowerCase())}</span><span class="val">${fmtMoney(r.subtotal)}</span></div>`;
        })
        .join("");
      return `<div class="band"><span>${esc(sub.label)}</span></div>${roomsHtml}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} Cotización Artefactos — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600;700&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <!-- PORTADA -->
  <div class="page">
    <div class="wm">${iso ? `<img src="${iso}" style="width:78mm;opacity:.07;" />` : ""}</div>
    <div class="pad-cover">
      <div class="cover-top">
        ${logoHtml}
        <div class="cover-meta">
          <div class="m1">Cotización · Artefactos</div>
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
          <div class="kick">Cotización de artefactos · detalle</div>
          <div class="proj">${esc(project.name)}</div>
          <div class="psub">${esc(project.clientName)} · ${esc(coverTitle)}</div>
        </div>
        <div class="right">
          <div class="ver">${esc(versionLarga)}</div>
          <div class="doc">${esc(budget.version)} Cotización</div>
          <div class="docsub">Artefactos</div>
        </div>
      </div>

      ${sections}

      <div class="cierre">
        <div>
          <div class="blk-title">Forma de pago</div>
          <div class="pagos">
            ${terms
              .map(
                (t) => `<div class="row"><span class="s">${esc(t.stage)}</span><span class="p">${t.percentage}%</span></div>`
              )
              .join("")}
          </div>
        </div>
        <div>
          <div class="resumen">
            ${orderedSubcats
              .map(
                (s) => `<div class="row"><span class="rl">${esc(s.label)}</span><span class="rv">${fmtMoney(s.subtotal)}</span></div>`
              )
              .join("")}
            <div class="grand"><span class="gl">Total artefactos</span><span class="gv">${fmtMoney(totalCliente)}</span></div>
          </div>
          <div class="iva-note">Valor IVA incluido</div>
        </div>
      </div>

      <div class="obs">
        <div class="blk-title">Observaciones</div>
        <div class="obs-list">
          ${OBSERVACIONES.map(
            (o, i) => `<div class="obs-item"><span class="obs-num">${i + 1}</span><span>${esc(o)}</span></div>`
          ).join("")}
          ${budget.observations ? `<div class="obs-item"><span class="obs-num">·</span><span>${esc(budget.observations)}</span></div>` : ""}
        </div>
      </div>
    </div>
  </div>

</body>
</html>`;
}

// Footer legacy (ya no se usa con la marca v2) — se mantiene por compat con el route.
export function buildArtefactosFooter(): string {
  return "";
}
