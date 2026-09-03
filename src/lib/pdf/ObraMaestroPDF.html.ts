/**
 * PDF "Cotizacion Maestro": variante del Obra PDF para entregarle al
 * maestro que va a ejecutar la obra. Mismas partidas y cantidades que la
 * cotizacion al cliente.
 *
 * Sale en DOS versiones, segun `conPrecios`:
 *   - SIN precios (default): columnas P.U. y TOTAL vacias — el maestro las
 *     completa con su propio precio. Es el documento para pedir cotizacion.
 *   - CON precios: P.U. y TOTAL ya llenos con la MANO DE OBRA acordada, mas
 *     un total general al pie. Es el documento para cuando el trato ya esta
 *     cerrado y hay que dejar por escrito que se le paga por cada partida.
 *
 * Cada capitulo cierra con su propia fila de SUBTOTAL. Con precios lleva la
 * suma de la mano de obra de ese capitulo (la suma de todos da exacto el total
 * al pie); sin precios la celda va en blanco, con su recuadro, para que el
 * maestro la complete a mano.
 *
 * OJO — el precio que va es `costLabor` (la mano de obra que BLARQ le paga al
 * maestro), NUNCA el `unitPrice` que se le cobra al cliente. La diferencia
 * entre los dos es material y margen de BLARQ: mostrarsela al maestro seria
 * mostrarle el margen. `costLabor` es UNITARIO (mismo dato que el Estado de
 * Pago usa como `laborUnitPrice`), asi que el total de la fila es
 * costLabor x cantidad.
 *
 * En las dos versiones: sin formas de pago y sin observaciones del cliente.
 */

import fs from "node:fs";
import path from "node:path";
import { sanitizeRichTextHtml, plainTextToHtml } from "@/lib/richText";
import { groupByChapter, type ChapterLike } from "@/lib/presupuesto/chapters";
import { annotateZones } from "@/lib/presupuesto/zones";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

export interface ObraMaestroItemInput {
  chapterId: string | null;
  // Sub-chapter opcional (ej. "COCINA", "BANO") para agrupar partidas
  // dentro del capitulo. La zona se DERIVA por posicion (helper compartido
  // annotateZones): una partida sin zona hereda la de arriba. No hay
  // subtotales por zona porque el maestro no tiene precios.
  subChapter: string | null;
  // Orden manual (el que arma MJ arrastrando en la cotizacion). El maestro
  // respeta ESTE orden, igual que la cotizacion y el PDF al cliente.
  sortOrder: number;
  name: string;
  // El alcance del maestro muestra la descriptionMaestro (instrucciones de
  // ejecucion) y NADA MAS: si esta vacia, la celda va vacia. Hasta 2026-08-15
  // caia a descriptionCliente; decidido con MJ que la herencia se va, porque
  // la descripcion del cliente trae condiciones comerciales, precios de
  // provision y notas internas que no van en el alcance de un maestro.
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  // Mano de obra UNITARIA que BLARQ le paga al maestro por esta partida.
  // Solo se imprime cuando `conPrecios` esta prendido. Nunca el precio al
  // cliente (ver nota en el encabezado del archivo).
  costLabor: number | null;
}

export interface ObraMaestroHTMLInput {
  project: {
    name: string;
    clientName: string;
    address: string | null;
  };
  budget: {
    version: string;
    date: string | Date;
  };
  maestro: { name: string | null } | null;
  chapters: ChapterLike[];
  items: ObraMaestroItemInput[];
  // false/undefined = documento para cotizar (P.U. y TOTAL en blanco).
  // true = documento con la mano de obra acordada ya escrita.
  conPrecios?: boolean;
}

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

// CSS calcado del ObraPDF.html.ts (mismo lenguaje visual BLARQ). Cambios:
//   - sin .totals (no van), sin .payment, sin .obs
//   - columnas P.U./TOTAL quedan vacias en cuerpo, headers iguales
//   - tamano base un pelin mas grande (5.8pt) porque hay menos contenido
//     y el maestro lo va a leer en obra, no en escritorio.
const CSS = `
  @page { size: A4; margin: 12mm 12mm 12mm 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Montserrat', Calibri, Arial, sans-serif;
    font-size: 5.8pt; font-weight: 400; color: #000;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    margin-bottom: 6px;
  }
  .header-left  { text-align: left; }
  .header-right { text-align: right; }

  .logo { display: block; height: 36px; width: auto; margin-bottom: 1px; }

  .doc-block { margin-bottom: 4px; line-height: 1; }
  .doc-version-label { font-size: 5.5pt; color: #404040; font-weight: 400; line-height: 1.1; }
  .doc-title {
    font-family: 'Montserrat', sans-serif;
    font-size: 14pt; font-weight: 500; color: #808080;
    line-height: 1; margin: 1px 0 0 0; letter-spacing: 0.01em;
  }
  .doc-subtitle {
    font-size: 7pt; font-weight: 500; color: #808080;
    letter-spacing: 0.05em; margin: 1px 0 0 0; text-transform: uppercase;
  }

  .field { margin-bottom: 2px; line-height: 1.1; }
  .field .label { font-size: 5.5pt; font-weight: 400; color: #404040; }
  .field .value { font-size: 6pt; font-weight: 700; color: #000; text-transform: uppercase; }

  table.partidas {
    width: 100%; border-collapse: collapse; table-layout: fixed;
    font-size: 5.6pt; margin-top: 4px;
  }
  .partidas th, .partidas td {
    padding: 1.5px 3px; vertical-align: middle;
    border: none; border-bottom: 0.4pt solid #000;
    word-wrap: break-word; line-height: 1.15;
  }
  .partidas thead th {
    background: #DBDBDB; color: #000; font-weight: 700;
    text-transform: uppercase; padding: 3px 3px;
    font-size: 5.8pt; text-align: center; line-height: 1;
    border-top: 0.4pt solid #000; border-bottom: 0.4pt solid #000;
  }
  .partidas tr.chapter-row td {
    background: #DBDBDB; font-weight: 700; text-transform: uppercase;
    padding: 2px 3px; font-size: 5.8pt;
    border-bottom: 0.4pt solid #000;
  }
  .partidas tr.chapter-row td.chapter-idx { text-align: center; }

  /* Subtotal de cada capitulo, en una fila propia que lo cierra (la
     convencion del presupuesto en papel: el numero cae donde uno termina de
     leer el capitulo, no antes de empezarlo). Mas liviana que el total
     general: gris claro, sin el doble filete que cierra el documento.
     Sin precios la celda del monto va en blanco —con su recuadro— para que
     el maestro la complete a mano cuando imprime. */
  .partidas tr.chapter-subtotal-row td {
    background: #F2F2F2;
    font-weight: 700;
    font-size: 5.8pt;
    padding: 2px 3px;
    border-bottom: 0.4pt solid #000;
  }
  .partidas tr.chapter-subtotal-row td.subtotal-label {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .partidas tr.chapter-subtotal-row td.vacia { background: #FFF; }

  /* Fila separadora de sub-chapter (ej. "COCINA", "BANO"). Gris mas
     claro que el chapter, italic, sin bordes — separador visual sutil. */
  .partidas tr.sub-chapter-row td {
    background: #F2F2F2;
    font-weight: 600;
    font-style: italic;
    text-transform: uppercase;
    padding: 2px 6px;
    font-size: 5.8pt;
    border-bottom: 0.4pt solid #999;
    letter-spacing: 0.02em;
  }

  /* P.U. y TOTAL: en la version sin precios van en blanco (ancho
     proporcional para que el maestro escriba a mano si imprime); en la
     version con precios llevan la mano de obra acordada. */
  .col-item   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-name   { width: 19%; text-align: left;   font-weight: 600; }
  .col-desc   { width: 40%; text-align: left;   font-weight: 400; }
  /* Descripción con formato (negrita/cursiva/listas/color del editor). */
  .col-desc p  { margin: 0; }
  .col-desc ul { margin: 0; padding-left: 12px; list-style: disc; }
  .col-desc ol { margin: 0; padding-left: 14px; list-style: decimal; }
  .col-desc li { margin: 0; }
  .col-desc strong { font-weight: 700; }
  .col-desc em { font-style: italic; }
  .col-unit   { width: 5%;  text-align: center; white-space: nowrap; }
  .col-qty    { width: 8%;  text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-pu     { width: 10%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }
  .col-total  { width: 13%; text-align: right;  font-variant-numeric: tabular-nums; white-space: nowrap; }

  tr { page-break-inside: avoid; }

  /* Total general de mano de obra — solo en la version con precios. Mismo
     trato tipografico que el resto: negro, bold, sin color decorativo. */
  .partidas tr.total-row td {
    border-top: 0.6pt solid #000;
    border-bottom: 0.6pt solid #000;
    font-weight: 700;
    font-size: 6.4pt;
    padding: 3px 3px;
  }
  .partidas tr.total-row td.total-label {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Nota al pie: explica cual de las dos versiones del documento es esta. */
  .footer-note {
    margin-top: 14px;
    font-size: 6pt;
    color: #404040;
    line-height: 1.35;
    padding-top: 4px;
    border-top: 0.4pt solid #CCC;
  }
`;

export function renderObraMaestroHTML(data: ObraMaestroHTMLInput): string {
  const { project, budget, maestro, items } = data;
  const conPrecios = data.conPrecios === true;

  // Mano de obra por partida (unitaria x cantidad). Se calcula siempre; solo
  // se imprime cuando conPrecios. Sin costLabor cargado, la partida vale 0 —
  // se muestra igual (es del maestro, solo le falta el precio: mismo criterio
  // que esSinManoDeObra, que ya filtro las que NO son suyas).
  const totalManoObra = items.reduce(
    (sum, it) => sum + (it.costLabor ?? 0) * it.quantity,
    0
  );

  // Capitulos en el MISMO orden y numeracion que la cotizacion (helper
  // compartido lib/presupuesto/chapters.ts, con reflow saltando vacios). Las
  // partidas en orden de sortOrder (el orden manual de MJ), NO alfabetico.
  const chapters = groupByChapter(data.chapters, items).map((g) => ({
    key: g.chapter.id,
    label: g.chapter.name,
    items: g.items,
    index: g.index ?? 0,
  }));

  const logoUri = getLogoDataUri();
  const dateStr = fmtDate(budget.date);

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo" style="line-height:44px;font-size:24pt;font-weight:700;letter-spacing:0.15em;">BLARQ</div>`;

  const tableRows = chapters
    .map((ch) => {
      // Subtotal del capitulo = la mano de obra de SUS partidas (unitaria x
      // cantidad, igual que el total al pie). Suma exactamente lo que el
      // documento muestra: las partidas sin mano de obra ya vienen filtradas
      // desde la ruta, y si viene ?maestroId= solo llegan las de ese maestro.
      // Por eso la suma de los subtotales da exacto el total general.
      const subtotal = ch.items.reduce(
        (s, i) => s + (i.costLabor ?? 0) * i.quantity,
        0
      );
      return `
        <tr class="chapter-row">
          <td class="col-item chapter-idx">${ch.index}</td>
          <td class="col-name">${esc(ch.label)}</td>
          <td class="col-desc"></td>
          <td class="col-unit"></td>
          <td class="col-qty"></td>
          <td class="col-pu"></td>
          <td class="col-total"></td>
        </tr>
        ${annotateZones(ch.items.map((i) => ({ ...i, total: 0 })))
          .rows
          .map((row, idx) => {
            const item = row.item;
            // Zona derivada por posicion: el encabezado va en la primera
            // partida de cada zona (gris claro, con el nombre de la zona).
            return `
          ${
            row.isZoneStart
              ? `<tr class="sub-chapter-row">
                  <td colspan="7">${esc(row.zone!)}</td>
                </tr>`
              : ""
          }
          <tr>
            <td class="col-item">${ch.index}.${idx + 1}</td>
            <td class="col-name">${esc(item.name)}</td>
            <td class="col-desc">${sanitizeRichTextHtml(
              // SOLO la del maestro: si está vacía, la celda va vacía. No se
              // hereda la del cliente (ver nota en el encabezado del archivo).
              // plainTextToHtml: las descripciones de maestro viejas son texto
              // plano con saltos de línea — sin esto se aplastan en un renglón.
              plainTextToHtml(item.descriptionMaestro)
            )}</td>
            <td class="col-unit">${esc(item.unit)}</td>
            <td class="col-qty">${fmtQty(item.quantity)}</td>
            <td class="col-pu">${
              conPrecios ? fmtNum(item.costLabor ?? 0) : ""
            }</td>
            <td class="col-total">${
              conPrecios
                ? fmtMoney((item.costLabor ?? 0) * item.quantity)
                : ""
            }</td>
          </tr>`;
          })
          .join("")}
        <tr class="chapter-subtotal-row">
          <td class="subtotal-label" colspan="6">Subtotal ${esc(ch.label)}</td>
          ${
            conPrecios
              ? `<td class="col-total">${fmtMoney(subtotal)}</td>`
              : `<td class="col-total vacia"></td>`
          }
        </tr>
      `;
    })
    .join("");

  const addressStr = project.address ? esc(project.address) : "POR CONFIRMAR";
  const maestroStr = maestro?.name ? esc(maestro.name) : "—";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(budget.version)} COTIZACION MAESTRO — ${esc(project.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div class="field">
        <div class="label">Mandante</div>
        <div class="value">${esc(project.clientName)}</div>
      </div>
      <div class="field">
        <div class="label">Proyecto</div>
        <div class="value">${esc(project.name)}</div>
      </div>
      <div class="field">
        <div class="label">Direccion</div>
        <div class="value">${addressStr}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-block">
        <div class="doc-version-label">Version:</div>
        <div class="doc-title">${esc(budget.version)} COTIZACION</div>
        <div class="doc-subtitle">${
          conPrecios ? "MAESTRO — OBRA · CON PRECIOS" : "MAESTRO — OBRA"
        }</div>
      </div>
      <div class="field">
        <div class="label">Profesional a cargo</div>
        <div class="value">${esc(PROFESSIONAL)}</div>
      </div>
      <div class="field">
        <div class="label">Maestro</div>
        <div class="value">${maestroStr}</div>
      </div>
      <div class="field">
        <div class="label">Fecha</div>
        <div class="value">${dateStr}</div>
      </div>
    </div>
  </div>

  <table class="partidas">
    <thead>
      <tr>
        <th class="col-item">ITEM</th>
        <th class="col-name">PARTIDA</th>
        <th class="col-desc">DESCRIPCION</th>
        <th class="col-unit">UNIDAD</th>
        <th class="col-qty">CANT.</th>
        <th class="col-pu">P.U.</th>
        <th class="col-total">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      ${
        conPrecios
          ? `<tr class="total-row">
               <td class="total-label" colspan="6">Total mano de obra</td>
               <td class="col-total">${fmtMoney(totalManoObra)}</td>
             </tr>`
          : ""
      }
    </tbody>
  </table>

  <div class="footer-note">
    ${
      conPrecios
        ? `Este documento es el alcance de la obra con los precios de mano de obra acordados.
           P.U. es el precio unitario de mano de obra de cada partida; TOTAL es P.U. por la cantidad.
           No incluye materiales.`
        : `Este documento es el alcance de la obra para cotizacion del maestro.
           Las columnas P.U. y TOTAL quedan en blanco para que el maestro las complete con sus precios.`
    }
  </div>

</body>
</html>`;
}

export function buildObraMaestroFooter(version: string, date: string | Date): string {
  const dateStr = fmtDate(date);
  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 7pt;
      color: #808080;
      width: 100%;
      padding: 4px 12mm 0;
      margin: 0;
      border-top: 0.4pt solid #CCC;
      display: flex;
      justify-content: space-between;
    ">
      <span>blarq.cl · cotizacion maestro</span>
      <span>${esc(version)} — ${dateStr}</span>
    </div>
  `;
}
