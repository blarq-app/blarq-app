// Plantilla del PDF de una FACTURA EMITIDA por BLARQ, con la marca BLARQ.
//
// Replica el formato legal de factura electrónica chilena (el mismo que
// generaba Maxxa) pero impreso por nosotros: logo BLARQ, recuadro del RUT,
// tabla de detalle, totales, timbre electrónico (PDF417) y la copia CEDIBLE.
// Lo legal (folio + timbre) sale del DTE; esta plantilla solo le pone la
// pinta. Todo en negro (línea editorial BLARQ).
//
// NOTA SII: la norma de impresión del SII tradicionalmente pide el recuadro
// de identificación (RUT + tipo doc + folio) en ROJO. MJ lo prefiere en negro.
// Lo legal es el DTE/timbre, no el color del PDF; si al certificar el SII
// exige rojo, se cambia el color de `.rut-box` y `.rut-sii`.
//
// El timbre (PDF417) se pasa ya rendereado como data URI en `timbreDataUri`.
// Si no viene (ej. vista previa de diseño), se muestra un placeholder.
//
// Lo consume renderPDF() (Puppeteer).

import fs from "fs";
import path from "path";

// ─── Datos fijos del emisor (BLARQ) ─────────────────────────────────────────
const EMISOR = {
  rut: "77.270.733-9",
  razonSocial: "BLARQ SPA",
  giro: "EJECUCIÓN URBANÍSTICOS, ARQUITECTÓNICOS, CONSTRUCCIONES",
  direccion: "LOS MILITARES 5620 OF 905 PS 9, LAS CONDES, LAS CONDES",
  fono: "987380297",
  email: "jtlarrain@blarq.cl",
  unidadSII: "S.I.I LAS CONDES",
} as const;

const DTE_LABEL: Record<number, string> = {
  33: "Factura electrónica afecta",
  34: "Factura electrónica exenta",
  56: "Nota de débito electrónica",
  61: "Nota de crédito electrónica",
};

export interface FacturaItem {
  codigo?: string;
  detalle: string;
  cantidad: number;
  unidad?: string;
  pUnitario: number;
  descPct?: number;
  total: number;
}

export interface FacturaReferencia {
  tipoDocLabel: string;
  folio: string;
  fecha: string; // ya formateada
  razon?: string;
}

export interface FacturaEmitidaInput {
  tipoDoc: number;
  folioNumber: string;
  emisionDate: Date;
  venceDate?: Date | null;
  formaPago?: string; // "Contado" | "Crédito"
  tipoVenta?: string; // "Del Giro"
  tipoCompra?: string; // "Del Giro"
  receptor: {
    razonSocial: string;
    rut: string;
    giro?: string;
    direccion?: string;
    comuna?: string;
    ciudad?: string;
    contacto?: string;
  };
  items: FacturaItem[];
  netAmount: number;
  iva: number;
  totalAmount: number;
  referencias?: FacturaReferencia[];
  observacion?: string;
  timbreDataUri?: string; // PDF417 ya rendereado
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

// P.Unitario chileno: con dos decimales (ej. $12.414.946,00).
function fmtUnit(n: number): string {
  return "$" + n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getLogoDataUri(): string {
  const logoPath = path.join(process.cwd(), "public", "assets", "logo-blarq.png");
  try {
    const bytes = fs.readFileSync(logoPath);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

// Construye el cuerpo de una página (sin <html>). `cedible` agrega la franja
// de acuse de recibo + leyenda CEDIBLE al pie.
function pageBody(inv: FacturaEmitidaInput, logoUri: string, cedible: boolean): string {
  const docLabel = DTE_LABEL[inv.tipoDoc] ?? "Documento electrónico";

  const logoHtml = logoUri
    ? `<img class="logo" src="${logoUri}" alt="BLARQ" />`
    : `<div class="logo-text">BLARQ</div>`;

  const itemRows = inv.items
    .map(
      (it) => `<tr>
        <td>${esc(it.codigo ?? "-")}</td>
        <td>${esc(it.detalle)}</td>
        <td class="num">${it.cantidad.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="ctr">${esc(it.unidad ?? "")}</td>
        <td class="num">${fmtUnit(it.pUnitario)}</td>
        <td class="num">${(it.descPct ?? 0).toFixed(2)}</td>
        <td class="num">${fmtCLP(it.total)}</td>
      </tr>`
    )
    .join("");

  const refRows = (inv.referencias ?? [])
    .map(
      (r) => `<tr>
        <td>${esc(r.tipoDocLabel)}</td>
        <td>${esc(r.folio)}</td>
        <td>${esc(r.fecha)}</td>
        <td>${esc(r.razon ?? "")}</td>
      </tr>`
    )
    .join("");

  const timbreHtml = inv.timbreDataUri
    ? `<img class="timbre" src="${esc(inv.timbreDataUri)}" alt="Timbre electrónico" />`
    : `<div class="timbre-placeholder">[ TIMBRE ELECTRÓNICO ]</div>`;

  const cedibleFooter = cedible
    ? `<div class="cedible">
         <div class="acuse">
           Nombre:_____________________ RUT:_____________ Fecha:__________ Recinto:____________ Firma:_______________
         </div>
         <div class="acuse-legal">
           "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4°, y la letra c) del Art. 5° de la Ley 19.983, acredita que la entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s)." <span class="cedible-tag">CEDIBLE</span>
         </div>
       </div>`
    : "";

  return `
  <div class="sheet">
    <!-- Header -->
    <div class="header">
      <div class="hd-logo">${logoHtml}</div>
      <div class="hd-emisor">
        <div class="em-name">${esc(EMISOR.razonSocial)}</div>
        <div class="em-line">${esc(EMISOR.giro)}</div>
        <div class="em-line">${esc(EMISOR.direccion)}</div>
        <div class="em-line">Tipo Venta: ${esc(inv.tipoVenta ?? "Del Giro")} &nbsp;&nbsp; Fono ${esc(EMISOR.fono)}</div>
        <div class="em-line">${esc(EMISOR.email)}</div>
      </div>
      <div class="hd-rut">
        <div class="rut-box">
          <div>R.U.T ${esc(EMISOR.rut)}</div>
          <div>${esc(docLabel)}</div>
          <div class="rut-folio">N° ${esc(inv.folioNumber)}</div>
        </div>
        <div class="rut-sii">${esc(EMISOR.unidadSII)}</div>
      </div>
    </div>

    <!-- Receptor -->
    <div class="receptor">
      <div class="rc-col">
        <div><span class="lbl">Cliente</span> ${esc(inv.receptor.razonSocial)}</div>
        <div><span class="lbl">R.U.T</span> ${esc(inv.receptor.rut)}</div>
        <div><span class="lbl">Giro</span> ${esc(inv.receptor.giro ?? "")}</div>
        <div><span class="lbl">Dirección</span> ${esc(inv.receptor.direccion ?? "")}</div>
      </div>
      <div class="rc-col">
        <div><span class="lbl">Comuna</span> ${esc(inv.receptor.comuna ?? "")}</div>
        <div><span class="lbl">Ciudad</span> ${esc(inv.receptor.ciudad ?? "")}</div>
        <div><span class="lbl">Contacto</span> ${esc(inv.receptor.contacto ?? "")}</div>
        <div><span class="lbl">Emisión</span> ${fmtDate(inv.emisionDate)}</div>
      </div>
      <div class="rc-col">
        <div><span class="lbl">Fma Pago</span> ${esc(inv.formaPago ?? "Contado")}</div>
        <div><span class="lbl">Vence</span> ${fmtDate(inv.venceDate ?? inv.emisionDate)}</div>
        <div><span class="lbl">Tipo Compra</span> ${esc(inv.tipoCompra ?? "Del Giro")}</div>
      </div>
    </div>

    <!-- Detalle -->
    <div class="detalle-box">
      <table class="detalle">
        <thead>
          <tr>
            <th>Código</th><th>Detalle</th><th class="num">Cantidad</th>
            <th class="ctr">Unid</th><th class="num">P.Unitario</th>
            <th class="num">Desc</th><th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    <!-- Pie: referencias + totales -->
    <div class="bottom">
      <table class="refs">
        <thead><tr><th>Documento Ref</th><th>Folio</th><th>Fecha</th><th>Razón Ref.</th></tr></thead>
        <tbody>${refRows}</tbody>
      </table>
      <table class="totales">
        <tr><td class="lbl">Neto</td><td class="num">${fmtCLP(inv.netAmount)}</td></tr>
        <tr><td class="lbl">I.V.A</td><td class="num">${fmtCLP(inv.iva)}</td></tr>
        <tr class="tot"><td class="lbl">Total</td><td class="num">${fmtCLP(inv.totalAmount)}</td></tr>
      </table>
    </div>

    <!-- Footer: timbre + observación -->
    <div class="foot">
      <div class="foot-timbre">
        ${timbreHtml}
        <div class="timbre-cap">Timbre Electrónico SII Res. 80 del 2014<br/>Verifique documento: www.sii.cl</div>
      </div>
      <div class="foot-obs">
        <div class="obs-title">Observación</div>
        <div class="obs-body">${esc(inv.observacion ?? "")}</div>
      </div>
    </div>

    ${cedibleFooter}
  </div>`;
}

export function renderFacturaEmitidaHtml(inv: FacturaEmitidaInput): string {
  const logoUri = getLogoDataUri();
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(DTE_LABEL[inv.tipoDoc] ?? "Documento")} N° ${esc(inv.folioNumber)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    margin: 0;
    font-size: 8.5pt;
    line-height: 1.3;
  }
  .sheet {
    padding: 10mm 10mm 8mm;
    min-height: 297mm;
    display: flex;
    flex-direction: column;
    page-break-after: always;
  }
  .sheet:last-child { page-break-after: auto; }

  /* Header */
  .header { display: flex; gap: 10px; align-items: flex-start; }
  .hd-logo { width: 150px; flex-shrink: 0; }
  .logo { display: block; width: 140px; height: auto; }
  .logo-text { font-size: 22pt; font-weight: 700; letter-spacing: 0.12em; }
  .hd-emisor { flex: 1; }
  .em-name { font-weight: 700; font-size: 10pt; }
  .em-line { font-size: 8pt; color: #333; }
  .hd-rut { width: 180px; flex-shrink: 0; text-align: center; }
  .rut-box {
    border: 2px solid #1a1a1a; color: #1a1a1a; font-weight: 700;
    padding: 8px 6px; border-radius: 3px; line-height: 1.5;
  }
  .rut-folio { font-size: 12pt; }
  .rut-sii { color: #1a1a1a; font-weight: 700; margin-top: 4px; font-size: 9pt; }

  /* Receptor */
  .receptor {
    display: flex; gap: 0; margin-top: 10px;
    border: 1px solid #1a1a1a; border-radius: 3px;
  }
  .rc-col { flex: 1; padding: 6px 10px; }
  .rc-col:not(:last-child) { border-right: 1px solid #d9d9d9; }
  .rc-col > div { padding: 1.5px 0; }
  .lbl { color: #1a1a1a; font-weight: 700; }

  /* Detalle: recuadro que se estira para llenar la página (como Maxxa) */
  .detalle-box {
    border: 1px solid #1a1a1a; border-radius: 3px;
    margin-top: 10px; flex: 1; overflow: hidden;
  }
  .detalle { width: 100%; border-collapse: collapse; }
  .detalle thead th {
    text-align: left; color: #1a1a1a; font-weight: 700;
    border-bottom: 1px solid #1a1a1a;
    padding: 4px 6px; vertical-align: bottom;
  }
  .detalle tbody td { padding: 4px 6px; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .ctr { text-align: center; }

  /* Bottom: refs + totales */
  .bottom { display: flex; gap: 12px; align-items: flex-start; margin-top: 6px; }
  .refs { flex: 1; border-collapse: collapse; }
  .refs th {
    text-align: left; color: #1a1a1a; font-weight: 700;
    border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a;
    padding: 4px 6px;
  }
  .refs td { padding: 3px 6px; }
  .totales { width: 200px; border-collapse: collapse; flex-shrink: 0; }
  .totales td { border: 1px solid #1a1a1a; padding: 4px 8px; }
  .totales td.lbl { color: #1a1a1a; font-weight: 700; width: 80px; }
  .totales tr.tot td { font-weight: 700; }

  /* Footer: timbre + obs */
  .foot { display: flex; gap: 12px; align-items: flex-start; margin-top: 10px; }
  .foot-timbre { width: 240px; flex-shrink: 0; text-align: center; }
  .timbre { width: 200px; height: auto; }
  .timbre-placeholder {
    width: 200px; height: 70px; border: 1px dashed #999; color: #999;
    display: flex; align-items: center; justify-content: center; font-size: 8pt;
    margin: 0 auto;
  }
  .timbre-cap { font-size: 7pt; color: #333; margin-top: 3px; }
  .foot-obs { flex: 1; }
  .obs-title { color: #1a1a1a; font-weight: 700; border: 1px solid #1a1a1a; border-bottom: none; padding: 3px 6px; }
  .obs-body { border: 1px solid #1a1a1a; min-height: 50px; padding: 4px 6px; }

  /* Cedible */
  .cedible { margin-top: 8px; border-top: 1px solid #1a1a1a; padding-top: 4px; }
  .acuse { font-size: 8pt; letter-spacing: 0.02em; }
  .acuse-legal { font-size: 6.5pt; color: #333; margin-top: 3px; }
  .cedible-tag { color: #1a1a1a; font-weight: 700; font-size: 11pt; }
</style>
</head>
<body>
  ${pageBody(inv, logoUri, false)}
  ${pageBody(inv, logoUri, true)}
</body>
</html>`;
}
