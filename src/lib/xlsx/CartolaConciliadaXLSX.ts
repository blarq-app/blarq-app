/**
 * Excel de la cartola conciliada del mes, para el contador (pendiente 196).
 *
 * Es el archivo con el que él TRABAJA: los números son números (suma, filtra,
 * ordena) y cada movimiento del banco trae al lado con qué se concilia. Dos
 * hojas:
 *
 *   1. "Cartola": todos los movimientos del mes, en el orden de la cartola, una
 *      fila por movimiento. Si un movimiento paga VARIAS facturas, cada factura
 *      va en una fila de abajo con el mismo N°, sin repetir el cargo/abono (así
 *      sumar la columna Cargo sigue dando el total del banco, y sumar Aplicado
 *      da lo conciliado). Al final, chico, el resumen y la cuadratura de saldos.
 *   2. "Pagadas en partes": cada factura del mes que se pagó en más de una
 *      transferencia (o a la que le queda saldo), con TODAS sus transferencias
 *      —también las de fuera del período— y cuánto le queda después de cada
 *      una. Es la vista que el contador no puede armar solo.
 *
 * Sale igual para un mes o para el AÑO COMPLETO; en el del año, la cuadratura
 * va además mes a mes, para ver en qué mes no calza algo.
 *
 * NO CALCULA NADA PROPIO: pinta lo que arma `armarCartola`
 * (lib/contabilidad/cartolaConciliada.ts), la misma cuenta que el PDF.
 *
 * Molde visual: CuadroResumenXLSX.ts / ObraMaestroXLSX.ts (Calibri, grises del
 * Manual v2, encabezado en Banda, sin cuadrícula).
 */

import ExcelJS from "exceljs";
import { MESES, type CartolaConciliada, type FilaCartola } from "@/lib/contabilidad/cartolaConciliada";

// ─── Paleta: los grises del Manual v2 (globals.css), en ARGB ────────────────
const GRIS = {
  100: "FFEEEDEC",
  200: "FFE2E1DF",
  300: "FFCFCBC5",
  400: "FFA9A093",
  500: "FF8A7F6F",
  600: "FF655D51",
  900: "FF2A2722",
} as const;
const BANDA = "FFEDEDEC";
// Ámbar = atención (CLAUDE.md §3): los pendientes y parciales. El resto de los
// estados va en gris, para que lo que hay que mirar se vea solo.
const AMBAR = "FF92400E";
const FONDO_AMBAR = "FFFEF3C7";

const FUENTE = "Calibri";
const FMT_MONTO = '"$"#,##0;-"$"#,##0;"$"0';
const FMT_FECHA = "dd-mm-yyyy";
// La diferencia de la cuadratura: en cero dice "cuadra".
const FMT_DIFERENCIA = '"$"#,##0;-"$"#,##0;"cuadra"';

const BLARQ_RUT = "77.270.733-9";

type Estilo = {
  color?: string;
  bold?: boolean;
  size?: number;
  italic?: boolean;
  fill?: string;
  align?: "left" | "right" | "center";
  numFmt?: string;
  bottom?: string;
};

function aplicar(cell: ExcelJS.Cell, e: Estilo) {
  cell.font = {
    name: FUENTE,
    size: e.size ?? 9,
    bold: e.bold ?? false,
    italic: e.italic ?? false,
    color: { argb: e.color ?? GRIS[900] },
  };
  // Sangría de 1: Excel no tiene padding y sin esto los textos quedan pegados
  // a la columna de al lado ("Saldo Estado").
  const horizontal = e.align ?? "left";
  cell.alignment = { horizontal, vertical: "top", indent: horizontal === "center" ? 0 : 1 };
  if (e.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: e.fill } };
  if (e.numFmt) cell.numFmt = e.numFmt;
  if (e.bottom) cell.border = { bottom: { style: "thin", color: { argb: e.bottom } } };
}

// Celda con fórmula. El `result` va SIEMPRE resuelto: sin él, los visores que
// no recalculan (Vista previa de Mac, Drive, WhatsApp) muestran la celda VACÍA.
function formula(cell: ExcelJS.Cell, f: string, result: number) {
  cell.value = { formula: f, result } as ExcelJS.CellFormulaValue;
}

// Folio como número cuando es solo dígitos (así Excel no marca "número
// guardado como texto"); los folios con letras quedan como texto.
function valorFolio(folio: string | null): string | number | null {
  if (!folio) return null;
  return /^\d{1,15}$/.test(folio) ? Number(folio) : folio;
}

function encabezado(ws: ExcelJS.Worksheet, fila: number, titulos: string[], derecha: Set<number>) {
  const row = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    aplicar(c, {
      bold: true,
      size: 8,
      color: GRIS[600],
      fill: BANDA,
      align: derecha.has(i + 1) ? "right" : "left",
      bottom: GRIS[300],
    });
  });
  row.height = 18;
}

function titulo(ws: ExcelJS.Worksheet, texto: string, bajada: string) {
  const r1 = ws.getRow(1).getCell(1);
  r1.value = `BLARQ SpA · RUT ${BLARQ_RUT}`;
  aplicar(r1, { size: 8, color: GRIS[500] });
  const r2 = ws.getRow(2).getCell(1);
  r2.value = texto;
  aplicar(r2, { size: 14, bold: true });
  ws.getRow(2).height = 22;
  const r3 = ws.getRow(3).getCell(1);
  r3.value = bajada;
  aplicar(r3, { size: 9, color: GRIS[600], italic: true });
}

// ─── Hoja 1: la cartola ─────────────────────────────────────────────────────

const COLS_CARTOLA = [
  { t: "N°", w: 5 },
  { t: "Fecha", w: 11 },
  { t: "Cuenta", w: 10 },
  { t: "Descripción en el banco", w: 34 },
  { t: "Cargo", w: 13 },
  { t: "Abono", w: 13 },
  { t: "Saldo", w: 14 },
  { t: "Estado", w: 11 },
  { t: "Qué es", w: 30 },
  { t: "Detalle", w: 48 },
  { t: "Documento", w: 17 },
  { t: "Folio", w: 13 },
  { t: "RUT", w: 13 },
  { t: "Razón social", w: 34 },
  { t: "Aplicado", w: 13 },
];
// "Qué es" y "Detalle" van juntos (son la explicación); después, las facturas
// con lo aplicado a cada una.
const C = {
  n: 1, fecha: 2, cuenta: 3, desc: 4, cargo: 5, abono: 6, saldo: 7, estado: 8,
  queEs: 9, detalle: 10, documento: 11, folio: 12, rut: 13, razon: 14, aplicado: 15,
} as const;

function escribirMovimiento(ws: ExcelJS.Worksheet, fila: number, f: FilaCartola): number {
  // Un movimiento ocupa una fila, más una por cada documento extra que paga.
  const lineas = Math.max(1, f.aplicaciones.length);
  const atencion = f.estado !== "Conciliado";

  for (let i = 0; i < lineas; i++) {
    const row = ws.getRow(fila + i);
    const primera = i === 0;
    const ultima = i === lineas - 1;
    const borde = ultima ? GRIS[100] : undefined;
    // Las filas de continuación repiten N°, fecha y cuenta en gris claro: así
    // un filtro por cuenta o por N° no las separa de su movimiento.
    const tenue = primera ? GRIS[600] : GRIS[400];

    row.getCell(C.n).value = f.n;
    aplicar(row.getCell(C.n), { color: tenue, align: "right", bottom: borde });
    row.getCell(C.fecha).value = f.fecha;
    aplicar(row.getCell(C.fecha), { color: primera ? GRIS[900] : GRIS[400], numFmt: FMT_FECHA, bottom: borde });
    row.getCell(C.cuenta).value = f.cuenta;
    aplicar(row.getCell(C.cuenta), { color: tenue, bottom: borde });

    if (primera) {
      row.getCell(C.desc).value = f.descripcion;
      row.getCell(C.cargo).value = f.cargo;
      row.getCell(C.abono).value = f.abono;
      row.getCell(C.saldo).value = f.saldo;
      row.getCell(C.estado).value = f.estado;
      row.getCell(C.queEs).value = f.queEs;
      row.getCell(C.detalle).value = f.detalle;
    }
    aplicar(row.getCell(C.desc), { bottom: borde });
    aplicar(row.getCell(C.cargo), { numFmt: FMT_MONTO, align: "right", bottom: borde });
    aplicar(row.getCell(C.abono), { numFmt: FMT_MONTO, align: "right", bottom: borde });
    aplicar(row.getCell(C.saldo), { numFmt: FMT_MONTO, align: "right", color: GRIS[600], bottom: borde });
    aplicar(row.getCell(C.estado), {
      color: atencion ? AMBAR : GRIS[500],
      bold: atencion,
      fill: atencion && primera ? FONDO_AMBAR : undefined,
      bottom: borde,
    });
    aplicar(row.getCell(C.queEs), { bold: primera, bottom: borde });
    aplicar(row.getCell(C.detalle), { color: f.estado === "Pendiente" ? AMBAR : GRIS[600], bottom: borde });

    const a = f.aplicaciones[i];
    if (a) {
      row.getCell(C.documento).value = a.documento;
      row.getCell(C.folio).value = valorFolio(a.folio);
      row.getCell(C.rut).value = a.rut;
      row.getCell(C.razon).value = a.razonSocial;
      row.getCell(C.aplicado).value = a.aplicado;
    }
    aplicar(row.getCell(C.documento), { bottom: borde });
    aplicar(row.getCell(C.folio), { align: "left", bottom: borde });
    aplicar(row.getCell(C.rut), { bottom: borde });
    aplicar(row.getCell(C.razon), { bottom: borde });
    aplicar(row.getCell(C.aplicado), { numFmt: FMT_MONTO, align: "right", bottom: borde });
  }
  return fila + lineas;
}

// "del 02-01-2026 al 05-10-2026", para el documento del año: dice hasta dónde
// llegan las cartolas cargadas.
function rango(cartola: CartolaConciliada): string {
  const f = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
  return cartola.desde && cartola.hasta ? `Movimientos del ${f(cartola.desde)} al ${f(cartola.hasta)}. ` : "";
}

function hojaCartola(wb: ExcelJS.Workbook, cartola: CartolaConciliada) {
  const ws = wb.addWorksheet("Cartola", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", xSplit: 0, ySplit: 5, showGridLines: false }],
  });
  COLS_CARTOLA.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));

  const cuentas = cartola.cuadratura.map((q) => `${q.cuenta} ${q.numero}`).join(" y ");
  titulo(
    ws,
    `Cartola conciliada · ${cartola.periodo}`,
    `Cuentas corrientes Santander ${cuentas}. ${cartola.esAño ? rango(cartola) : ""}` +
      "Cada movimiento del banco, en orden, con lo que lo explica."
  );

  const FILA_ENC = 5;
  encabezado(
    ws,
    FILA_ENC,
    COLS_CARTOLA.map((c) => c.t),
    new Set([C.n, C.cargo, C.abono, C.saldo, C.aplicado])
  );

  let fila = FILA_ENC + 1;
  const primeraDato = fila;
  for (const f of cartola.filas) fila = escribirMovimiento(ws, fila, f);
  const ultimaDato = fila - 1;
  ws.autoFilter = { from: { row: FILA_ENC, column: 1 }, to: { row: ultimaDato, column: COLS_CARTOLA.length } };

  // ── Al final, chico: resumen y cuadratura ──
  fila += 2;
  const r = cartola.resumen;
  const resumen = ws.getRow(fila).getCell(C.desc);
  resumen.value =
    `${r.movimientos} movimientos · ${r.conciliados} conciliados · ` +
    `${r.parciales} ${r.parciales === 1 ? "parcial" : "parciales"} · ` +
    `${r.pendientes} ${r.pendientes === 1 ? "pendiente" : "pendientes"}`;
  aplicar(resumen, { size: 8, color: GRIS[600] });
  fila += 2;

  const tituloCuad = ws.getRow(fila).getCell(C.desc);
  tituloCuad.value = "Cuadratura de saldos";
  aplicar(tituloCuad, { size: 8, bold: true, color: GRIS[600] });
  fila += 1;

  // Va en las columnas D a J para que los montos caigan bajo Cargo/Abono/Saldo.
  const encCuad = ["Cuenta", "Saldo inicial", "+ Abonos", "− Cargos", "= Calculado", "Saldo final cartola", "Diferencia"];
  const filaEnc = ws.getRow(fila);
  encCuad.forEach((t, i) => {
    const c = filaEnc.getCell(C.desc + i);
    c.value = t;
    aplicar(c, { size: 8, bold: true, color: GRIS[600], fill: BANDA, align: i === 0 ? "left" : "right", bottom: GRIS[300] });
  });
  fila += 1;

  const columna = (col: number) => {
    const letra = ws.getColumn(col).letter;
    return `${letra}$${primeraDato}:${letra}$${ultimaDato}`;
  };
  const letraCuenta = ws.getColumn(C.cuenta).letter;
  for (const q of cartola.cuadratura) {
    const row = ws.getRow(fila);
    const col = (k: number) => row.getCell(C.desc + k);
    const L = (k: number) => ws.getColumn(C.desc + k).letter;
    col(0).value = `${q.cuenta} ${q.numero}`;
    aplicar(col(0), { size: 8 });
    col(1).value = q.saldoInicial;
    // Abonos y cargos se suman de la tabla de arriba: si el contador borra o
    // agrega una fila, la cuadratura se recalcula sola.
    formula(col(2), `SUMIFS(${columna(C.abono)},${letraCuenta}$${primeraDato}:${letraCuenta}$${ultimaDato},"${q.cuenta}")`, q.entradas);
    formula(col(3), `SUMIFS(${columna(C.cargo)},${letraCuenta}$${primeraDato}:${letraCuenta}$${ultimaDato},"${q.cuenta}")`, q.salidas);
    formula(col(4), `${L(1)}${fila}+${L(2)}${fila}-${L(3)}${fila}`, q.saldoCalculado);
    col(5).value = q.saldoFinalBanco;
    formula(col(6), `${L(5)}${fila}-${L(4)}${fila}`, q.diferencia);
    for (let k = 1; k <= 6; k++) {
      aplicar(col(k), {
        size: 8,
        numFmt: k === 6 ? FMT_DIFERENCIA : FMT_MONTO,
        align: "right",
        color: k === 6 && Math.abs(q.diferencia) > 0.5 ? AMBAR : GRIS[900],
        bold: k === 6 && Math.abs(q.diferencia) > 0.5,
      });
    }
    fila += 1;
  }

  // Año completo: la misma cuadratura mes a mes (valores, como la cartola de
  // cada mes), para ver en qué mes no calza algo.
  if (cartola.cuadraturaPorMes.length > 0) {
    fila += 1;
    const t = ws.getRow(fila).getCell(C.desc);
    t.value = "Mes a mes";
    aplicar(t, { size: 8, bold: true, color: GRIS[600] });
    fila += 1;
    for (const q of cartola.cuadraturaPorMes) {
      const row = ws.getRow(fila);
      const col = (k: number) => row.getCell(C.desc + k);
      col(0).value = `${MESES[q.month - 1]} · ${q.cuenta}`;
      aplicar(col(0), { size: 8 });
      const valores = [q.saldoInicial, q.entradas, q.salidas, q.saldoCalculado, q.saldoFinalBanco, q.diferencia];
      valores.forEach((v, i) => {
        const k = i + 1;
        col(k).value = v;
        const descuadre = k === 6 && Math.abs(q.diferencia) > 0.5;
        aplicar(col(k), {
          size: 8,
          numFmt: k === 6 ? FMT_DIFERENCIA : FMT_MONTO,
          align: "right",
          color: descuadre ? AMBAR : GRIS[600],
          bold: descuadre,
        });
      });
      fila += 1;
    }
  }

  const nota = ws.getRow(fila + 1).getCell(C.desc);
  nota.value =
    "Saldo inicial y final: los de la cartola del banco. Dentro de un mismo día el banco no fija el orden; " +
    "acá van primero los abonos. El saldo al cierre de cada día es el del banco.";
  aplicar(nota, { size: 8, italic: true, color: GRIS[500] });

  ws.pageSetup.printArea = `A1:${ws.getColumn(COLS_CARTOLA.length).letter}${fila + 1}`;
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws.pageSetup.printTitlesRow = `${FILA_ENC}:${FILA_ENC}`;
}

// ─── Hoja 2: facturas pagadas en partes ─────────────────────────────────────

const COLS_PARTES = [
  { t: "Venta / compra", w: 13 },
  { t: "Documento", w: 16 },
  { t: "Folio", w: 12 },
  { t: "RUT", w: 13 },
  { t: "Razón social", w: 36 },
  { t: "Total documento", w: 15 },
  { t: "Fecha pago", w: 11 },
  { t: "Cuenta", w: 10 },
  { t: "N° en cartola", w: 11 },
  { t: "Transferencia", w: 14 },
  { t: "Aplicado", w: 14 },
  { t: "Le queda", w: 14 },
];
const P = {
  lado: 1, documento: 2, folio: 3, rut: 4, razon: 5, total: 6,
  fecha: 7, cuenta: 8, n: 9, transferencia: 10, aplicado: 11, queda: 12,
} as const;

function hojaPartes(wb: ExcelJS.Workbook, cartola: CartolaConciliada) {
  const ws = wb.addWorksheet("Pagadas en partes", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", xSplit: 0, ySplit: 5, showGridLines: false }],
  });
  COLS_PARTES.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));
  titulo(
    ws,
    `Facturas pagadas en partes · ${cartola.periodo}`,
    `Facturas pagadas o cobradas ${cartola.esAño ? "este año" : "este mes"} en más de una transferencia, ` +
      `con todas sus transferencias (también las de ${cartola.esAño ? "otros años" : "otros meses"}, en gris) ` +
      "y cuánto le queda después de cada una."
  );
  const FILA_ENC = 5;
  encabezado(
    ws,
    FILA_ENC,
    COLS_PARTES.map((c) => c.t),
    new Set([P.total, P.n, P.transferencia, P.aplicado, P.queda])
  );

  let fila = FILA_ENC + 1;
  if (cartola.facturasPartidas.length === 0) {
    const c = ws.getRow(fila).getCell(1);
    c.value = `${cartola.esAño ? "Este año" : "Este mes"} no hay facturas pagadas en más de una transferencia.`;
    aplicar(c, { italic: true, color: GRIS[500] });
    return;
  }

  for (const fp of cartola.facturasPartidas) {
    // Fila del documento: total y lo que le queda al final.
    const head = ws.getRow(fila);
    head.getCell(P.lado).value = fp.lado === "venta" ? "Venta" : "Compra";
    head.getCell(P.documento).value = fp.anulada ? `${fp.documento} (anulada)` : fp.documento;
    head.getCell(P.folio).value = valorFolio(fp.folio);
    head.getCell(P.rut).value = fp.rut;
    head.getCell(P.razon).value = fp.razonSocial;
    head.getCell(P.total).value = fp.total;
    head.getCell(P.queda).value = fp.leQueda;
    for (let k = 1; k <= COLS_PARTES.length; k++) {
      const montos = k === P.total || k === P.queda;
      aplicar(head.getCell(k), {
        bold: true,
        numFmt: montos ? FMT_MONTO : undefined,
        align: montos ? "right" : "left",
        color: k === P.queda && Math.abs(fp.leQueda) > 1 ? AMBAR : GRIS[900],
      });
    }
    fila += 1;

    const lineas = [
      ...(fp.retencion > 0 ? [{ tipo: "retencion" as const }] : []),
      ...fp.pagos.map((p) => ({ tipo: "pago" as const, p })),
      ...fp.notasCredito.map((nc) => ({ tipo: "nc" as const, nc })),
    ];
    lineas.forEach((l, i) => {
      const row = ws.getRow(fila);
      const ultima = i === lineas.length - 1;
      const borde = ultima ? GRIS[200] : undefined;
      // El folio se repite en gris en cada línea, para filtrar por factura.
      row.getCell(P.folio).value = valorFolio(fp.folio);
      if (l.tipo === "pago") {
        const fuera = l.p.n == null;
        const color = fuera ? GRIS[400] : GRIS[900];
        row.getCell(P.fecha).value = l.p.fecha;
        row.getCell(P.cuenta).value = l.p.cuenta;
        row.getCell(P.n).value = l.p.n;
        row.getCell(P.transferencia).value = Math.abs(l.p.montoTransferencia);
        row.getCell(P.aplicado).value = l.p.aplicado;
        row.getCell(P.queda).value = l.p.leQueda;
        for (let k = 1; k <= COLS_PARTES.length; k++) {
          const num = k === P.transferencia || k === P.aplicado || k === P.queda;
          aplicar(row.getCell(k), {
            color: k === P.folio ? GRIS[400] : color,
            numFmt: num ? FMT_MONTO : k === P.fecha ? FMT_FECHA : undefined,
            align: num || k === P.n ? "right" : "left",
            italic: fuera && k !== P.folio,
            bottom: borde,
          });
        }
      } else if (l.tipo === "retencion") {
        // La parte de la boleta de honorarios que no se le transfiere a la
        // persona: BLARQ la entera al SII en el F29.
        const tasa = fp.retencionTasa != null ? ` ${(fp.retencionTasa * 100).toLocaleString("es-CL")}%` : "";
        row.getCell(P.documento).value = "Retención";
        row.getCell(P.razon).value = `Retención de honorarios${tasa}: la entera BLARQ en el F29`;
        row.getCell(P.aplicado).value = fp.retencion;
        row.getCell(P.queda).value = fp.total - fp.retencion;
        for (let k = 1; k <= COLS_PARTES.length; k++) {
          const num = k === P.aplicado || k === P.queda;
          aplicar(row.getCell(k), {
            color: k === P.folio ? GRIS[400] : GRIS[600],
            numFmt: num ? FMT_MONTO : undefined,
            align: num ? "right" : "left",
            bottom: borde,
          });
        }
      } else {
        row.getCell(P.documento).value = "Nota de crédito";
        row.getCell(P.razon).value = l.nc.folio ? `Nota de crédito ${l.nc.folio} aplicada a esta factura` : "Nota de crédito aplicada";
        row.getCell(P.aplicado).value = l.nc.monto;
        for (let k = 1; k <= COLS_PARTES.length; k++) {
          const num = k === P.aplicado;
          aplicar(row.getCell(k), {
            color: k === P.folio ? GRIS[400] : GRIS[600],
            numFmt: num ? FMT_MONTO : undefined,
            align: num ? "right" : "left",
            bottom: borde,
          });
        }
      }
      fila += 1;
    });
    fila += 1; // aire entre facturas
  }

  ws.autoFilter = { from: { row: FILA_ENC, column: 1 }, to: { row: fila - 1, column: COLS_PARTES.length } };
  ws.pageSetup.printArea = `A1:${ws.getColumn(COLS_PARTES.length).letter}${fila}`;
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws.pageSetup.printTitlesRow = `${FILA_ENC}:${FILA_ENC}`;
}

export async function buildCartolaConciliadaXLSX(cartola: CartolaConciliada): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BLARQ";
  wb.created = new Date();
  hojaCartola(wb, cartola);
  hojaPartes(wb, cartola);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
