// HTML de la liquidación de sueldo (remuneraciones), para imprimir/guardar.
// Lo consume renderPDF() (Puppeteer). Reproduce la liquidación mensual que
// calcula sueldos.ts (validada al peso contra las liquidaciones reales).
//
// Estética BLARQ: blanco/negro/gris, tabular-nums, sin color decorativo.

import type { Liquidacion } from "@/lib/contabilidad/sueldos";

export interface LiquidacionPDFInput {
  liquidacion: Liquidacion;
  afpNombre: string | null;
  isapreNombre: string | null;
  isaprePlanUF: number;
  // Período
  mesNombre: string;
  year: number;
  // Indicadores del mes (para el pie)
  uf: number;
  utm: number;
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

function fmtDec(n: number, dec = 2): string {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dec,
  }).format(n);
}

// Una fila de la liquidación (glosa + valor). `sub` = línea de detalle gris.
function row(glosa: string, valor: number, opts: { strong?: boolean; sub?: boolean } = {}): string {
  const cls = [opts.strong ? "strong" : "", opts.sub ? "sub" : ""].join(" ").trim();
  return `<tr class="${cls}"><td class="g">${esc(glosa)}</td><td class="v">${fmtCLP(valor)}</td></tr>`;
}

export function renderLiquidacionHtml(input: LiquidacionPDFInput): string {
  const l = input.liquidacion;
  const blarqRut = "77.270.733-9";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Liquidación ${esc(l.nombre)} ${esc(input.mesNombre)} ${input.year}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    margin: 0;
    padding: 18mm 16mm;
    font-size: 10.5pt;
    line-height: 1.4;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #111827;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .brand { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; }
  .brand-sub { font-size: 9pt; color: #6b7280; margin-top: 2px; }
  .doc-id { text-align: right; }
  .doc-id .label { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .doc-id .periodo { font-size: 15pt; font-weight: 700; margin-top: 2px; }
  .doc-id .rut { font-size: 9pt; color: #4b5563; margin-top: 4px; }

  .worker {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 10px 12px;
    background: #fafafa;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .worker .name { font-size: 13pt; font-weight: 600; }
  .worker .rut { font-size: 10pt; color: #4b5563; margin-top: 2px; }
  .worker .prev { font-size: 9pt; color: #6b7280; text-align: right; }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
  .col-title {
    font-size: 8pt; color: #6b7280; text-transform: uppercase;
    letter-spacing: 0.08em; margin-bottom: 4px;
  }
  table { width: 100%; border-collapse: collapse; }
  td.g { padding: 4px 0; color: #374151; }
  td.v { padding: 4px 0; text-align: right; font-variant-numeric: tabular-nums; }
  tr.sub td { color: #9ca3af; font-size: 9.5pt; padding: 2px 0 2px 10px; }
  tr.strong td {
    border-top: 1px solid #111827; font-weight: 700; padding-top: 6px;
  }

  .liquido {
    border: 2px solid #111827;
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 6px;
  }
  .liquido .lbl { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .liquido .val { font-size: 18pt; font-weight: 800; font-variant-numeric: tabular-nums; }

  .footer {
    margin-top: 18px;
    font-size: 8pt;
    color: #9ca3af;
    border-top: 1px solid #e5e7eb;
    padding-top: 6px;
    line-height: 1.5;
  }
  .footer .ind { color: #6b7280; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">BLARQ</div>
      <div class="brand-sub">Liquidación de remuneraciones</div>
    </div>
    <div class="doc-id">
      <div class="label">Período</div>
      <div class="periodo">${esc(input.mesNombre)} ${input.year}</div>
      <div class="rut">BLARQ SPA · RUT ${blarqRut}</div>
    </div>
  </div>

  <div class="worker">
    <div>
      <div class="name">${esc(l.nombre)}</div>
      <div class="rut">RUT ${esc(l.rut)}</div>
    </div>
    <div class="prev">
      AFP ${esc(input.afpNombre ?? "—")}<br/>
      Isapre ${esc(input.isapreNombre ?? "—")} · plan ${fmtDec(input.isaprePlanUF, 3)} UF
    </div>
  </div>

  <div class="cols">
    <div>
      <div class="col-title">Haberes</div>
      <table>
        ${row("Sueldo base", l.sueldoBase)}
        ${row("Gratificación legal", l.gratificacion)}
        ${row("Total imponible", l.totalImponible, { strong: true })}
        ${row("Colación", l.colacion)}
        ${row("Movilización", l.movilizacion)}
        ${row("Total no imponible", l.totalNoImponible, { strong: true })}
        ${row("Total haberes", l.totalHaberes, { strong: true })}
      </table>
    </div>
    <div>
      <div class="col-title">Descuentos</div>
      <table>
        ${row("AFP (10% + comisión)", l.totalAfp)}
        ${row("· Capitalización 10%", l.afpCapitalizacion, { sub: true })}
        ${row("· Comisión AFP", l.afpComision, { sub: true })}
        ${row("Salud (plan Isapre)", l.totalSalud)}
        ${row("· Cotización legal 7%", l.saludLegal, { sub: true })}
        ${row("· Adicional del plan", l.saludAdicional, { sub: true })}
        ${row("Seguro de cesantía", l.cesantia)}
        ${row("Impuesto único", l.impuestoUnico)}
        ${row("Total descuentos", l.totalDescuentos, { strong: true })}
      </table>
    </div>
  </div>

  <div class="liquido">
    <div class="lbl">Líquido a pagar</div>
    <div class="val">${fmtCLP(l.liquido)}</div>
  </div>

  <div class="footer">
    <span class="ind">Indicadores del mes — UF ${fmtDec(input.uf, 2)} · UTM ${fmtCLP(input.utm)} · base impuesto único ${fmtCLP(l.baseImpuesto)}.</span><br/>
    Documento de uso interno generado por BLARQ a partir de los datos de
    remuneraciones. El impuesto único retenido se declara en el código 048 del F29.
  </div>
</body>
</html>`;
}
