// HTML del PDF de la cartola conciliada del mes, para el contador (pendiente
// 196). Lo consume renderPDF() (Puppeteer), en A4 apaisado.
//
// Es la versión PARA LEER del Excel (CartolaConciliadaXLSX.ts) y muestra lo
// mismo, en el mismo orden (por mes o por año completo):
//   1. La cartola, cuenta por cuenta: cada movimiento del banco y, al lado, con
//      qué se concilia (qué es, el detalle y las facturas con lo aplicado a
//      cada una). Va PRIMERO: MJ no entendió la maqueta que arrancaba con saldos.
//   2. Las facturas pagadas en partes, con todas sus transferencias.
//   3. Al final, chico, el resumen y la cuadratura de saldos.
//
// NO calcula plata: pinta lo que arma armarCartola (cartolaConciliada.ts).
// Estética del Manual v2: Nunito Sans, grises piedra, tabular-nums, ámbar solo
// para lo que hay que mirar (pendientes y parciales).

import {
  MESES,
  type CartolaConciliada,
  type CuadraturaCuenta,
  type FacturaPartida,
  type FilaCartola,
} from "@/lib/contabilidad/cartolaConciliada";

const BLARQ_RUT = "77.270.733-9";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clp(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CL");
}

// Fechas de movimiento: día calendario guardado a medianoche UTC.
function fecha(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// Fecha de emisión del PDF: un instante real, en hora local.
function fechaLocal(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function celdaConcilia(f: FilaCartola): string {
  const docs = f.aplicaciones.length
    ? `<table class="docs">${f.aplicaciones
        .map(
          (a) => `<tr>
            <td class="doc">${esc(a.documento)}${a.folio ? ` ${esc(a.folio)}` : ""}</td>
            <td class="razon">${a.razonSocial ? esc(a.razonSocial) : ""}</td>
            <td class="rut">${a.rut ?? ""}</td>
            <td class="num">${clp(a.aplicado)}</td>
          </tr>`
        )
        .join("")}</table>`
    : "";
  return `<div class="q">${esc(f.queEs)}</div>${
    f.detalle ? `<div class="det${f.estado === "Pendiente" ? " atn" : ""}">${esc(f.detalle)}</div>` : ""
  }${docs}`;
}

function estado(f: FilaCartola): string {
  if (f.estado === "Conciliado") return `<span class="ok">Conciliado</span>`;
  return `<span class="pill">${f.estado}</span>`;
}

function tablaCuenta(filas: FilaCartola[]): string {
  return `<table class="cartola">
    <colgroup>
      <col style="width:7mm"><col style="width:16mm"><col style="width:52mm">
      <col style="width:19mm"><col style="width:19mm"><col style="width:21mm">
      <col style="width:17mm"><col>
    </colgroup>
    <thead><tr>
      <th class="num">N°</th><th>Fecha</th><th>Descripción en el banco</th>
      <th class="num">Cargo</th><th class="num">Abono</th><th class="num">Saldo</th>
      <th>Estado</th><th>Con qué se concilia</th>
    </tr></thead>
    <tbody>${filas
      .map(
        (f) => `<tr class="${f.estado !== "Conciliado" ? "fila-atn" : ""}">
        <td class="num n">${f.n}</td>
        <td class="fecha">${fecha(f.fecha)}</td>
        <td class="desc">${esc(f.descripcion)}</td>
        <td class="num">${f.cargo != null ? clp(f.cargo) : ""}</td>
        <td class="num">${f.abono != null ? clp(f.abono) : ""}</td>
        <td class="num saldo">${clp(f.saldo)}</td>
        <td>${estado(f)}</td>
        <td class="concilia">${celdaConcilia(f)}</td>
      </tr>`
      )
      .join("")}</tbody>
  </table>`;
}

function bloquePartida(fp: FacturaPartida, fuera: string): string {
  const tasa = fp.retencionTasa != null ? ` ${(fp.retencionTasa * 100).toLocaleString("es-CL")}%` : "";
  const lineas = [
    // La parte de la boleta de honorarios que no se le transfiere a la
    // persona: BLARQ la entera al SII en el F29.
    ...(fp.retencion > 0
      ? [
          `<tr>
        <td></td><td colspan="4">Retención de honorarios${tasa}: la entera BLARQ en el F29</td>
        <td></td><td class="num">${clp(fp.retencion)}</td><td class="num">${clp(fp.total - fp.retencion)}</td>
      </tr>`,
        ]
      : []),
    ...fp.pagos.map(
      (p) => `<tr class="${p.n == null ? "otro-mes" : ""}">
        <td class="fecha">${fecha(p.fecha)}</td>
        <td>${esc(p.cuenta)}</td>
        <td class="num">${p.n ?? fuera}</td>
        <td></td>
        <td class="desc">${esc(p.descripcion)}</td>
        <td class="num">${clp(Math.abs(p.montoTransferencia))}</td>
        <td class="num">${clp(p.aplicado)}</td>
        <td class="num">${clp(p.leQueda)}</td>
      </tr>`
    ),
    ...fp.notasCredito.map(
      (nc) => `<tr>
        <td></td><td colspan="4">Nota de crédito${nc.folio ? ` ${esc(nc.folio)}` : ""} aplicada a esta factura</td>
        <td></td><td class="num">${clp(nc.monto)}</td><td></td>
      </tr>`
    ),
  ].join("");
  const queda = Math.abs(fp.leQueda) > 1;
  return `<div class="partida">
    <div class="p-head">
      <div><span class="lado">${fp.lado === "venta" ? "Venta" : "Compra"}</span>
        <b>${esc(fp.documento)}${fp.folio ? ` ${esc(fp.folio)}` : ""}</b>${fp.anulada ? " (anulada)" : ""}
        · ${fp.razonSocial ? esc(fp.razonSocial) : ""}${fp.rut ? ` · ${fp.rut}` : ""}</div>
      <div class="p-tot">Total ${clp(fp.total)} · <span class="${queda ? "atn" : ""}">le queda ${clp(fp.leQueda)}</span></div>
    </div>
    <table class="pagos">
      <colgroup><col style="width:18mm"><col style="width:17mm"><col style="width:19mm"><col style="width:4mm"><col><col style="width:24mm"><col style="width:24mm"><col style="width:24mm"></colgroup>
      <thead><tr><th>Fecha</th><th>Cuenta</th><th class="num">N° cartola</th><th></th><th>Descripción en el banco</th>
        <th class="num">Transferencia</th><th class="num">Aplicado</th><th class="num">Le queda</th></tr></thead>
      <tbody>${lineas}</tbody>
    </table>
  </div>`;
}

function filaCuadratura(q: CuadraturaCuenta, rotulo: string): string {
  return `<tr>
    <td>${esc(rotulo)}</td>
    <td class="num">${clp(q.saldoInicial)}</td>
    <td class="num">${clp(q.entradas)}</td>
    <td class="num">${clp(q.salidas)}</td>
    <td class="num">${clp(q.saldoCalculado)}</td>
    <td class="num">${clp(q.saldoFinalBanco)}</td>
    <td class="num">${Math.abs(q.diferencia) > 0.5 ? `<span class="atn">${clp(q.diferencia)}</span>` : "cuadra"}</td>
  </tr>`;
}

export function renderCartolaConciliadaHtml(cartola: CartolaConciliada, emitidoEl: Date): string {
  const periodo = capital(cartola.periodo);
  const cuentas = cartola.cuadratura;
  const r = cartola.resumen;

  const secciones = cuentas
    .map((q) => {
      const filas = cartola.filas.filter((f) => f.cuenta === q.cuenta);
      return `<section class="cuenta">
        <h2>Cuenta ${esc(q.cuenta)} <span>${esc(q.numero)} · ${q.movimientos} movimientos</span></h2>
        ${filas.length ? tablaCuenta(filas) : `<p class="vacio">Sin movimientos en el período.</p>`}
      </section>`;
    })
    .join("");

  const partidas = cartola.facturasPartidas.length
    ? `<section class="partidas">
        <h2>Facturas pagadas en partes</h2>
        <p class="bajada">Facturas pagadas o cobradas ${cartola.esAño ? "este año" : "este mes"} en más de una
        transferencia, con todas sus transferencias (las de ${cartola.esAño ? "otros años" : "otros meses"} van en
        gris) y cuánto le queda después de cada una.</p>
        ${cartola.facturasPartidas.map((fp) => bloquePartida(fp, cartola.esAño ? "otro año" : "otro mes")).join("")}
      </section>`
    : "";

  const cuadratura = `<section class="cierre">
    <h3>Resumen</h3>
    <p class="resumen">${r.movimientos} movimientos · ${r.conciliados} conciliados ·
      ${r.parciales} ${r.parciales === 1 ? "parcial" : "parciales"} ·
      <span class="${r.pendientes ? "atn" : ""}">${r.pendientes} ${r.pendientes === 1 ? "pendiente" : "pendientes"}</span></p>
    <h3>Cuadratura de saldos</h3>
    <table class="cuad">
      <thead><tr><th>Cuenta</th><th class="num">Saldo inicial</th><th class="num">+ Abonos</th>
        <th class="num">− Cargos</th><th class="num">= Calculado</th><th class="num">Saldo final cartola</th><th class="num">Diferencia</th></tr></thead>
      <tbody>${cuentas.map((q) => filaCuadratura(q, `${q.cuenta} ${q.numero}`)).join("")}</tbody>
    </table>
    ${
      cartola.cuadraturaPorMes.length
        ? `<h3>Mes a mes</h3>
    <table class="cuad">
      <thead><tr><th>Mes</th><th class="num">Saldo inicial</th><th class="num">+ Abonos</th>
        <th class="num">− Cargos</th><th class="num">= Calculado</th><th class="num">Saldo final cartola</th><th class="num">Diferencia</th></tr></thead>
      <tbody>${cartola.cuadraturaPorMes
        .map((q) => filaCuadratura(q, `${capital(MESES[q.month - 1])} · ${q.cuenta}`))
        .join("")}</tbody>
    </table>`
        : ""
    }
    <p class="nota">Saldo inicial y final: los de la cartola del banco. Dentro de un mismo día el banco no fija el
    orden; acá van primero los abonos. El saldo al cierre de cada día es el del banco.</p>
  </section>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Cartola conciliada ${esc(periodo)} — BLARQ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  /* Apaisado: la columna "con qué se concilia" necesita el ancho. El margen
     lo fija este @page (renderPDF con preferCSSPageSize) y el pie de página
     va en el margen de abajo. */
  @page { size: A4 landscape; margin: 9mm 10mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Nunito Sans', -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #36322C; margin: 0; font-size: 7.4pt; line-height: 1.35;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .num, .fecha { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .num { text-align: right; }
  .atn { color: #92400E; }

  .head { display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 1px solid #36322C; padding-bottom: 6px; margin-bottom: 4px; }
  .marca { font-size: 6.5pt; letter-spacing: .28em; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 14pt; margin: 3px 0 0; font-weight: 700; letter-spacing: -.01em; }
  .sub { font-size: 7pt; color: #736A5C; margin-top: 2px; }
  .head-der { text-align: right; font-size: 7pt; color: #736A5C; }
  .leyenda { font-size: 7.2pt; color: #736A5C; margin: 0 0 8px; }

  h2 { font-size: 9pt; font-weight: 700; margin: 10px 0 4px; }
  h2 span { font-weight: 400; color: #9B9182; font-size: 7.5pt; margin-left: 6px; }
  .cuenta + .cuenta { break-before: page; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { text-align: left; font-size: 6pt; letter-spacing: .08em; text-transform: uppercase; color: #736A5C;
    font-weight: 600; background: #EDECEB; padding: 3px 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .cartola td { padding: 2.5px 4px; border-bottom: 1px solid #E7E6E4; vertical-align: top; }
  .cartola .n { color: #9B9182; }
  .cartola .desc { color: #625A4F; word-break: break-word; }
  .cartola .saldo { color: #736A5C; }
  .ok { color: #9B9182; }
  .pill { display: inline-block; font-size: 6pt; font-weight: 700; letter-spacing: .04em; color: #92400E;
    background: #FEF3C7; border-radius: 999px; padding: 0 5px; }
  .q { font-weight: 700; }
  .det { color: #736A5C; }
  .det.atn { color: #92400E; }
  .docs { margin-top: 1px; }
  .docs td { padding: 0 4px 0 0; border: 0; color: #36322C; vertical-align: top; }
  .docs .doc { width: 40mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .docs .rut { width: 18mm; color: #736A5C; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .docs .num { width: 19mm; padding-right: 0; }
  .docs .razon { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .partidas { break-before: page; }
  .bajada { font-size: 7.2pt; color: #736A5C; margin: 0 0 8px; }
  .partida { break-inside: avoid; margin-bottom: 9px; }
  .p-head { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
    border-bottom: 1px solid #36322C; font-size: 7.6pt; }
  .p-tot { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .lado { font-size: 6pt; letter-spacing: .08em; text-transform: uppercase; color: #736A5C;
    border: 1px solid #C4BEB5; border-radius: 999px; padding: 0 5px; margin-right: 5px; }
  .pagos th { background: none; padding: 3px 4px 2px; border-bottom: 1px solid #DCDAD6; }
  .pagos td { padding: 2px 4px; border-bottom: 1px solid #F0EFED; }
  .pagos .desc { color: #625A4F; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .otro-mes td { color: #ADA599; font-style: italic; }

  .cierre { break-inside: avoid; margin-top: 14px; font-size: 7pt; }
  .cierre h3 { font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase; color: #736A5C;
    font-weight: 600; margin: 10px 0 3px; }
  .resumen { margin: 0; color: #625A4F; }
  .cuad { width: auto; table-layout: auto; }
  .cuad th { font-size: 5.6pt; padding: 2px 8px 2px 0; background: none; border-bottom: 1px solid #DCDAD6; }
  .cuad td { padding: 2px 8px 2px 0; color: #625A4F; font-variant-numeric: tabular-nums; }
  .nota { color: #ADA599; font-style: italic; margin: 6px 0 0; }
  .vacio { color: #9B9182; font-style: italic; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="marca">BLARQ</div>
      <h1>Cartola conciliada · ${esc(periodo)}</h1>
      <div class="sub">Cuentas corrientes Santander ${cuentas.map((q) => `${esc(q.cuenta)} ${esc(q.numero)}`).join(" y ")}${
        cartola.esAño && cartola.desde && cartola.hasta
          ? ` · movimientos del ${fecha(cartola.desde)} al ${fecha(cartola.hasta)}`
          : ""
      }</div>
    </div>
    <div class="head-der">Emitido ${fechaLocal(emitidoEl)}<br>BLARQ SpA · RUT ${BLARQ_RUT}</div>
  </div>
  <p class="leyenda">Cada movimiento del banco, en el orden de la cartola, con lo que lo explica: la factura que paga
  (y cuánto a cada una cuando son varias) o qué es cuando no tiene factura. Los pendientes van marcados.</p>
  ${secciones}
  ${partidas}
  ${cuadratura}
</body>
</html>`;
}

// Pie de página: el período a la izquierda, la página a la derecha.
export function pieCartolaConciliada(cartola: CartolaConciliada): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 6.5pt; color: #9B9182;
      width: 100%; padding: 0 10mm; display: flex; justify-content: space-between;">
    <span>BLARQ · Cartola conciliada ${capital(cartola.periodo)}</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;
}
