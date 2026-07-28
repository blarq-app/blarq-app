/**
 * PDF "Orden de compra de artefactos" (2026-07-28).
 *
 * Es la SEGUNDA salida de la cotización de artefactos: los mismos productos
 * pero SIN NINGÚN PRECIO, para mandarle al proveedor que despacha (Kitchen
 * House para lo de cocina, MK para baño, etc.). El proveedor necesita saber
 * QUÉ modelo y CUÁNTOS — lo que BLARQ le cobra al cliente no es asunto suyo.
 *
 * Se emite UNA orden por subcategoría (cocina / sanitarios / iluminación),
 * porque cada una se le compra a una empresa distinta. Adentro se respetan
 * los bloques (ambientes) tal como MJ los ordenó en el editor.
 *
 * La foto va a propósito: es lo que evita que el proveedor despache otro
 * modelo de la misma línea. Decisión de MJ 2026-07-28.
 *
 * Self-contained a propósito (mismo criterio que MueblistaPDF): no toca el
 * PDF de artefactos al cliente, así no hay riesgo de filtrar precios ahí.
 */

import fs from "node:fs";
import path from "node:path";

const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

export const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Artefactos sanitarios",
  cocina: "Artefactos cocina",
  iluminacion: "Artefactos iluminación",
};

// Etiqueta corta para el nombre del archivo descargado.
const SUBCATEGORY_SLUG: Record<string, string> = {
  sanitario: "Sanitarios",
  cocina: "Cocina",
  iluminacion: "Iluminacion",
};

// ─── Types ────────────────────────────────────────────────────────────────
export interface OrdenCompraItemInput {
  room: string;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  imageUrl: string | null;
}

export interface OrdenCompraHTMLInput {
  project: {
    name: string;
    clientName: string;
    address: string | null;
  };
  budget: { version: string; date: string | Date };
  // Clave de subcategoría: sanitario | cocina | iluminacion.
  subcategory: string;
  // Items YA filtrados a esa subcategoría y ordenados por sortOrder.
  items: OrdenCompraItemInput[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}·${month}·${year}`;
}

// Línea y color derivados del nombre — espejo exacto del editor y del PDF de
// artefactos al cliente (ArtefactosPDF.html.ts). Se duplican acá a propósito
// para no acoplar este PDF al del cliente: si mañana cambia uno, el otro no
// se rompe. Si la lista crece mucho, recién ahí vale extraerla a un helper.
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

// ─── CSS — marca v2 (Claro), misma paleta que el PDF al cliente ────────────
const CSS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Nunito Sans', sans-serif;
    color: #36322C;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #36322C; padding-bottom: 5mm; margin-bottom: 3mm; }
  .head-logo { width: 31mm; height: auto; opacity: .78; display: block; }
  .head .kick { font-size: 5.5pt; letter-spacing: .26em; text-transform: uppercase; color: #9B9182; font-weight: 700; margin-top: 6mm; }
  .head .proj { font-family: 'Hanken Grotesk', sans-serif; font-weight: 200; font-size: 17pt; line-height: 1.08; letter-spacing: .05em; text-transform: uppercase; color: #36322C; margin-top: 3pt; padding-right: 8mm; }
  .head .psub { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 7.5pt; color: #9B9182; margin-top: 3pt; }
  .head .right { text-align: right; }
  .head .doc { font-family: 'Hanken Grotesk', sans-serif; font-weight: 300; font-size: 14pt; line-height: 1.08; letter-spacing: .05em; text-transform: uppercase; color: #776E60; }
  .head .docsub { display: inline-block; font-family: 'Hanken Grotesk', sans-serif; font-weight: 500; font-size: 6.4pt; letter-spacing: .28em; text-transform: uppercase; color: #6C6B6B; margin-top: 5pt; border: 0.5px solid #B2ACA0; padding: 2.5pt 6pt 2.5pt 9pt; }
  .head .ver { font-size: 5.6pt; letter-spacing: .26em; text-transform: uppercase; color: #ADA599; font-weight: 700; margin-top: 6pt; }

  /* Aclaración de que la hoja NO lleva precios a propósito. */
  .nota { font-family: 'Spectral', serif; font-style: italic; font-weight: 300; font-size: 8pt; color: #78716A; margin-bottom: 4mm; }

  /* Banda del bloque/ambiente — misma gris del PDF al cliente. */
  .grp { display: flex; align-items: center; background: #EDECEB; padding: 4.5pt 12pt; margin-top: 7pt; break-inside: avoid; break-after: avoid; }
  .grp span { font-size: 6.4pt; letter-spacing: .2em; text-transform: uppercase; color: #736A5C; font-weight: 700; }

  /* Tabla 7 columnas: sin P. lista, sin Dcto, sin Total. */
  /* Foto más chica que en el PDF al cliente (24mm vs 32mm): acá la foto es
     para reconocer el modelo, no para vender. Con 32mm entraban 6 productos
     por hoja; con 24mm entran ~9 y la orden ocupa la mitad de páginas. */
  .ahd, .ar { display: grid; grid-template-columns: 26mm 21% 10% 10% 1fr 11% 22px; gap: 0 6pt; }
  .ahd { padding: 5pt 3pt; border-bottom: 0.3px solid #9B9182; font-size: 5.2pt; letter-spacing: .1em; text-transform: uppercase; color: #9B9182; font-weight: 700; break-inside: avoid; break-after: avoid; margin-top: 2pt; }
  .ahd .c { text-align: center; }
  .ar { align-items: center; padding: 4pt 3pt; border-bottom: 1px solid #E7E6E4; font-size: 6.8pt; line-height: 1.3; break-inside: avoid; }
  .ar .foto { width: 26mm; }
  .ar .foto img { max-width: 24mm; max-height: 24mm; object-fit: contain; display: block; }
  .ar .foto .ph { width: 24mm; height: 24mm; background: #F3F3F3; border: 1px solid #E1DFDD; }
  .a-it { color: #36322C; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; font-size: 6.6pt; }
  .a-ln { color: #36322C; text-transform: uppercase; letter-spacing: .04em; }
  .a-co, .a-de, .a-ma { color: #36322C; }
  /* La cantidad es EL dato de la orden: más peso que en el PDF al cliente. */
  .a-ct { text-align: center; color: #36322C; font-weight: 700; font-size: 8pt; font-variant-numeric: tabular-nums; }

  /* Cierre: cuántas líneas y cuántas unidades. Sin plata. */
  .cierre { display: flex; justify-content: space-between; align-items: baseline; padding: 5pt 3pt 3pt; margin-top: 7pt; border-bottom: 1px solid #36322C; break-inside: avoid; }
  .cierre .lbl { font-size: 7pt; letter-spacing: .1em; text-transform: uppercase; color: #36322C; font-weight: 700; }
  .cierre .val { font-size: 7pt; color: #36322C; font-weight: 700; font-variant-numeric: tabular-nums; }

  .empty { font-family: 'Spectral', serif; font-style: italic; font-size: 9pt; color: #9B9182; padding: 14mm 0; }
`;

// ─── HTML render ──────────────────────────────────────────────────────────
export function renderOrdenCompraArtefactosHTML(
  input: OrdenCompraHTMLInput
): string {
  const { project, budget, subcategory, items } = input;

  const subLabel = SUBCATEGORY_LABELS[subcategory] ?? subcategory;

  // Bloques (ambientes) en el ORDEN EN QUE VIENEN. Los items ya llegan
  // ordenados por sortOrder desde el route, que es el orden que MJ arrastró
  // en el editor — no se reordena por una lista fija, porque los bloques
  // pueden tener nombre libre (ej. "TEKA").
  const order: string[] = [];
  const byRoom = new Map<string, OrdenCompraItemInput[]>();
  for (const it of items) {
    const key = it.room || "otro";
    if (!byRoom.has(key)) {
      byRoom.set(key, []);
      order.push(key);
    }
    byRoom.get(key)!.push(it);
  }

  const colHeader = `<div class="ahd"><span>Foto</span><span>Ítem</span><span>Línea</span><span>Color</span><span>Detalle</span><span>Marca</span><span class="c">Cant</span></div>`;

  const body = order
    .map((rkey) => {
      const rItems = byRoom.get(rkey)!;
      const label = ROOM_LABELS[rkey] ?? rkey;
      const rows = rItems
        .map((it) => {
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
          </div>`;
        })
        .join("");
      return `<div class="grp"><span>${esc(label)}</span></div>${colHeader}${rows}`;
    })
    .join("");

  const totalUnidades = items.reduce((s, it) => s + it.quantity, 0);
  const logo = assetDataUri("blarq-logo-horizontal-ink.png") || assetDataUri("logo-blarq.png");
  const logoHtml = logo
    ? `<img class="head-logo" src="${logo}" alt="BLARQ" />`
    : `<div class="head-logo" style="font-family:'Hanken Grotesk';font-size:20pt;letter-spacing:.15em;">BLARQ</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Orden de compra ${esc(subLabel)} — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@200;300;400;500;600;700&family=Nunito+Sans:wght@300;400;600;700&family=Spectral:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  <div class="head">
    <div>
      ${logoHtml}
      <div class="kick">Orden de compra · ${esc(subLabel)}</div>
      <div class="proj">${esc(project.name)}</div>
      <div class="psub">${esc(project.clientName)}${project.address ? " · " + esc(project.address) : ""}</div>
    </div>
    <div class="right">
      <div class="doc">Orden de compra</div>
      <div class="docsub">${esc(subLabel.replace(/^Artefactos /i, ""))}</div>
      <div class="ver">${esc(budget.version)} · ${fmtDate(budget.date)}</div>
    </div>
  </div>

  <div class="nota">Listado de productos y cantidades, sin precios.</div>

  ${
    items.length > 0
      ? `${body}
  <div class="cierre">
    <span class="lbl">Total ${esc(subLabel.toLowerCase())}</span>
    <span class="val">${items.length} ${items.length === 1 ? "producto" : "productos"} · ${totalUnidades} ${totalUnidades === 1 ? "unidad" : "unidades"}</span>
  </div>`
      : `<div class="empty">Esta cotización no tiene ${esc(subLabel.toLowerCase())} cargados.</div>`
  }
</body>
</html>`;
}

// Nombre del archivo descargado, ej. BLARQ_OC_Cocina_Paseo_del_Sena_V3.pdf
export function ordenCompraFilename(
  subcategory: string,
  projectName: string,
  version: string
): string {
  const slug = SUBCATEGORY_SLUG[subcategory] ?? subcategory;
  const base = projectName.replace(/\s+/g, "_");
  return `BLARQ_OC_${slug}_${base}_${version}.pdf`;
}
