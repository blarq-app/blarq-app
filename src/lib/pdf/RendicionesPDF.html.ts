// HTML del PDF de las rendiciones de gastos de los socios, para el contador.
// Lo consume renderPDF() (Puppeteer), en A4 vertical.
//
// La versión PARA LEER (y firmar) del Excel (RendicionesXLSX.ts), con lo
// mismo: una sección por socio, cada reembolso de BLARQ con los documentos que
// lo respaldan, y al final los totales y las firmas.
//
// NO calcula plata: pinta lo que arma armarRendiciones (rendiciones.ts).
// Estética del Manual v2, como la cartola conciliada.

import type { Reembolso, RendicionSocio, Rendiciones } from "@/lib/contabilidad/rendiciones";

const BLARQ_RUT = "77.270.733-9";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clp(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CL");
}

function fecha(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

function fechaLocal(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function bloqueReembolso(re: Reembolso): string {
  const filas = re.lineas
    .map(
      (l) => `<tr>
      <td class="fecha">${fecha(l.fechaDocumento)}</td>
      <td class="corta">${esc(l.documento)}${l.folio ? ` ${esc(l.folio)}` : ""}</td>
      <td class="corta">${l.proveedor ? esc(l.proveedor) : ""}</td>
      <td class="rut">${l.rut ?? ""}</td>
      <td class="corta">${l.obra ? esc(l.obra) : '<span class="vacio">sin obra</span>'}</td>
      <td class="corta gris">${l.categoria ? esc(l.categoria) : ""}</td>
      <td class="num">${clp(l.rendido)}</td>
    </tr>`
    )
    .join("");
  const nota = re.nota
    ? `<div class="nota">${re.nota.split(/\n/).map((x) => esc(x.trim())).filter(Boolean).join("<br>")}</div>`
    : "";
  return `<div class="reembolso">
    <div class="r-head">
      <div><b>Reembolso ${fecha(re.fecha)}</b> · cuenta ${esc(re.cuenta)} · <span class="glosa">${esc(re.descripcion)}</span></div>
      <div class="num"><b>${clp(re.monto)}</b></div>
    </div>
    <table>
      <colgroup><col style="width:16mm"><col style="width:28mm"><col><col style="width:20mm"><col style="width:27mm"><col style="width:24mm"><col style="width:18mm"></colgroup>
      <thead><tr><th>Fecha</th><th>Documento</th><th>Proveedor</th><th>RUT</th><th>Obra</th><th>Categoría</th><th class="num">Rendido</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="r-pie">
      <span>Respaldado con documentos <b>${clp(re.respaldado)}</b></span>
      ${re.sinRespaldo > 0 ? `<span class="atn">Sin respaldo todavía <b>${clp(re.sinRespaldo)}</b></span>` : ""}
    </div>
    ${nota}
  </div>`;
}

function seccionSocio(r: Rendiciones, s: RendicionSocio, emitidoEl: Date): string {
  const cuerpo = s.reembolsos.map(bloqueReembolso).join("");
  return `<section class="socio">
    <div class="head">
      <div>
        <div class="marca">BLARQ</div>
        <h1>Rendición de gastos · ${esc(capital(r.periodo))}</h1>
        <div class="sub"><b>${esc(s.socio)}</b>${s.rut ? ` · RUT ${s.rut}` : ""}</div>
      </div>
      <div class="head-der">Emitido ${fechaLocal(emitidoEl)}<br>BLARQ SpA · RUT ${BLARQ_RUT}</div>
    </div>
    <p class="leyenda">Compras de BLARQ que ${esc(s.socio)} pagó con su plata y que BLARQ le reembolsó.
    Cada reembolso es una transferencia de BLARQ; debajo, los documentos que lo respaldan, con la obra y la categoría.
    ${s.reembolsos.length} ${s.reembolsos.length === 1 ? "reembolso" : "reembolsos"} · ${s.documentos} documentos.</p>
    ${cuerpo}
    <div class="totales">
      <table>
        <tr><td>Rendido con documentos</td><td class="num">${clp(s.respaldado)}</td></tr>
        <tr><td>Reembolsado por BLARQ</td><td class="num">${clp(s.total)}</td></tr>
        <tr class="${s.sinRespaldo > 0 ? "atn" : "cero"}"><td>Sin respaldo todavía</td><td class="num">${clp(s.sinRespaldo)}</td></tr>
      </table>
    </div>
    <div class="firmas">
      <div><div class="linea"></div>${esc(s.socio)}<br><span>Rinde</span></div>
      <div><div class="linea"></div>BLARQ SpA<br><span>Revisa</span></div>
    </div>
  </section>`;
}

export function renderRendicionesHtml(r: Rendiciones, emitidoEl: Date): string {
  const conReembolsos = r.socios.filter((s) => s.reembolsos.length > 0);
  const sinReembolsos = r.socios.filter((s) => s.reembolsos.length === 0);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Rendiciones ${esc(r.periodo)} — BLARQ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 12mm 13mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Nunito Sans', -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #36322C; margin: 0; font-size: 7.6pt; line-height: 1.35;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .num, .fecha { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .num { text-align: right; }
  .atn { color: #92400E; }
  .socio + .socio { break-before: page; }

  .head { display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 1px solid #36322C; padding-bottom: 6px; margin-bottom: 5px; }
  .marca { font-size: 6.5pt; letter-spacing: .28em; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 13pt; margin: 3px 0 0; font-weight: 700; letter-spacing: -.01em; }
  .sub { font-size: 8.5pt; margin-top: 2px; }
  .head-der { text-align: right; font-size: 7pt; color: #736A5C; }
  .leyenda { font-size: 7.2pt; color: #736A5C; margin: 0 0 10px; }

  .reembolso { margin-bottom: 10px; }
  .r-head { display: flex; justify-content: space-between; gap: 10px; padding: 3px 4px;
    background: #EDECEB; break-after: avoid; }
  .r-head .glosa { color: #736A5C; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { text-align: left; font-size: 5.8pt; letter-spacing: .08em; text-transform: uppercase; color: #9B9182;
    font-weight: 600; padding: 3px 4px 2px; border-bottom: 1px solid #DCDAD6; }
  thead { display: table-header-group; }
  td { padding: 2.5px 4px; border-bottom: 1px solid #F0EFED; vertical-align: top; }
  tr { break-inside: avoid; }
  .corta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rut { color: #736A5C; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gris { color: #736A5C; }
  .r-pie { display: flex; justify-content: flex-end; gap: 16px; padding: 3px 4px 0; color: #625A4F;
    font-variant-numeric: tabular-nums; break-before: avoid; }
  .nota { margin: 3px 4px 0; padding: 3px 6px; border-left: 2px solid #E7C48A; color: #92400E;
    font-size: 6.9pt; break-before: avoid; }

  .totales { break-inside: avoid; margin-top: 12px; display: flex; justify-content: flex-end; }
  .totales table { width: 78mm; }
  .totales td { font-size: 8pt; padding: 3px 4px; border-bottom: 1px solid #E7E6E4; }
  .totales tr:last-child td { border-bottom: 1px solid #36322C; font-weight: 700; }
  /* "El cero no ocupa espacio prominente": sin faltante, la fila va tenue. */
  .totales tr.cero td { font-weight: 400; color: #9B9182; }

  .firmas { break-inside: avoid; display: flex; gap: 30mm; margin-top: 22mm; font-size: 7.6pt; }
  .firmas > div { width: 60mm; text-align: center; }
  .firmas .linea { border-top: 1px solid #36322C; margin-bottom: 3px; }
  .firmas span { color: #9B9182; font-size: 6.8pt; }
  .vacio { color: #ADA599; font-style: italic; }
  .sin-reembolsos { margin-top: 14px; color: #736A5C; font-size: 7.4pt; }
</style>
</head>
<body>
  ${conReembolsos.map((s) => seccionSocio(r, s, emitidoEl)).join("")}
  ${
    // Quien no tuvo reembolsos en el período va en una línea, no en una hoja
    // vacía: el contador pidió las dos rendiciones y así sabe que no falta.
    sinReembolsos.length
      ? `<p class="sin-reembolsos">${sinReembolsos
          .map((s) => `${esc(s.socio)}${s.rut ? ` (RUT ${s.rut})` : ""} no tuvo reembolsos en ${esc(r.periodo)}.`)
          .join("<br>")}</p>`
      : ""
  }
</body>
</html>`;
}

export function pieRendiciones(r: Rendiciones): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 6.5pt; color: #9B9182;
      width: 100%; padding: 0 13mm; display: flex; justify-content: space-between;">
    <span>BLARQ · Rendiciones de gastos ${capital(r.periodo)}</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;
}
