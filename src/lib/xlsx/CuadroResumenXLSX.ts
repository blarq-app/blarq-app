/**
 * Excel del Cuadro Resumen (pendiente 190): el cuadro como .xlsx con NÚMEROS de
 * verdad — MJ puede sumar una columna, copiar un monto o pegarlo en otro
 * documento sin que se pixele.
 *
 * ES EL EXCEL DE MJ, NO EL DEL CLIENTE (decidido con ella el 2026-09-30, viendo
 * las dos versiones con Algarrobos y Candelaria). Por eso trae, además de la
 * hoja del cuadro, lo que la pantalla muestra y la imagen no: "Valores con IVA
 * incluido", la línea del pie ("Avance total cobrado…") y una segunda hoja
 * "Me paso a Sueldos" con el detalle de los traspasos. Lo que va al cliente
 * sigue siendo la imagen. Si algún día se quiere un Excel para el cliente, sale
 * de sacarle esas tres cosas a este mismo archivo.
 *
 * NO CALCULA NADA PROPIO. Toma el mismo `CuadroResumenData` que pinta la
 * pantalla (sale de `computeCuadroResumen`) y lo que depende del % de avance lo
 * pide a `lib/projects/cuadroAvance.ts`, las MISMAS funciones que usan la
 * pantalla y la imagen. Si un número del Excel no calza con la pantalla, es un
 * bug de este archivo, no una diferencia de criterio.
 *
 * La referencia visual es el render de exportación de `CuadroResumenAvance.tsx`
 * (el de la imagen): mismas columnas, mismo orden, mismas filas, mismos tonos
 * de la paleta. Incluida la fila AVANCE A COBRAR en #BFBCB8 — ese tono tiene
 * tres pasadas de decisión de MJ detrás (está contado en el componente): no se
 * cambia acá.
 *
 * CON FÓRMULAS (pedido de MJ, 2026-09-30). Son DATO, como número fijo, solo
 * los acordados, los pagos y el % de avance de cada concepto. Todo lo demás es
 * fórmula: TOTAL PAGOS y su %, lo que se pide en AVANCE A COBRAR, el SALDO, la
 * columna TOTAL, la línea del pie y la hoja "Me paso a Sueldos" (enganchada a
 * esta). Si MJ cambia un % en el Excel, se recalcula todo, como en pantalla.
 *
 * Las fórmulas repiten las cuentas de `calcularAvance` (pantalla) y, con los
 * datos tal como vienen, dan EXACTAMENTE lo mismo — cada una lleva al lado el
 * `result` que calculó la pantalla. Cuidados para que eso se cumpla:
 *   - Los montos van tal cual salen del cálculo, SIN redondear (formato de
 *     pesos sin decimales), así la suma de una columna es lo que la pantalla
 *     llama TOTAL PAGOS.
 *   - AVANCE A COBRAR va en pesos enteros (ROUND), porque la pantalla también
 *     lo imprime entero y su total es la suma de lo impreso.
 *   - El SALDO NO resta la celda de AVANCE (redondeada) sino la cuenta sin
 *     redondear, como `saldoNuevo`; si no, podía salir $1 distinto.
 *
 * Funciona igual en el navegador (el botón "Descargar Excel" lo arma ahí, con
 * el % recién tipeado) y en Node (scripts), por eso no lee archivos: el
 * isotipo llega ya en base64.
 */

import ExcelJS from "exceljs";
import { formatCLP } from "@/lib/utils";
import type { ConceptoCuadro, ConceptoKey, CuadroResumenData } from "@/lib/projects/cuadroResumen";
import {
  apilarPagos,
  calcularAvance,
  hayQuePedir,
  sumarTransferido,
  totalAPedirMostrado,
  totalTransferido,
  type CalculoAvance,
  type TransferenciaSueldo,
  type TransferidoPorConcepto,
} from "@/lib/projects/cuadroAvance";

export interface CuadroResumenXLSXInput {
  projectName: string;
  // Fecha del documento (la que va arriba a la derecha, como en la imagen).
  fecha: Date;
  data: CuadroResumenData;
  // % OBJETIVO por concepto, el que MJ tipeó en la fila AVANCE.
  avance: Record<string, number>;
  // Si en pantalla está prendido "Comparar con V_".
  mostrarAnterior: boolean;
  // Traspasos a Sueldos de la obra (hoja "Me paso a Sueldos").
  transferencias: TransferenciaSueldo[];
  // PNG del isotipo en base64 (con o sin prefijo data:). Sin él, sin logo.
  isotipoBase64?: string | null;
}

// ─── Paleta: los grises del Manual v2 (globals.css), en ARGB ────────────────
const GRIS = {
  50: "FFF5F5F5",
  100: "FFEEEDEC",
  200: "FFE2E1DF",
  300: "FFCFCBC5",
  400: "FFA9A093",
  500: "FF8A7F6F",
  600: "FF655D51",
  700: "FF4B453C",
  800: "FF39342D",
  900: "FF2A2722",
} as const;
// Encabezado de la tabla: la regla global `table thead th` pinta Banda.
const BANDA = "FFEDEDEC";
// Fondo de la fila AVANCE A COBRAR (ver comentario del componente).
const FONDO_AVANCE = "FFBFBCB8";

const FUENTE = "Calibri";
// Pesos sin decimales. El cero sale como guion, igual que en pantalla ("el cero
// no ocupa espacio prominente"). Excel pone el separador de miles del idioma de
// quien abre el archivo: en un Excel en español sale "$12.643.549".
const FMT_MONTO = '"$"#,##0;-"$"#,##0;"—"';
// La columna TOTAL imprime "$0" y no guion (formatCLP en pantalla).
const FMT_MONTO_TOTAL = '"$"#,##0';
const FMT_PCT = "0%";
const FMT_FECHA = "dd-mm-yy";

type Estilo = {
  color?: string;
  bold?: boolean;
  size?: number;
  italic?: boolean;
  fill?: string;
  align?: "left" | "right" | "center";
  numFmt?: string;
  top?: string;
  bottom?: string;
  left?: string;
};

function aplicar(cell: ExcelJS.Cell, e: Estilo) {
  cell.font = {
    name: FUENTE,
    size: e.size ?? 9,
    bold: e.bold ?? false,
    italic: e.italic ?? false,
    color: { argb: e.color ?? GRIS[900] },
  };
  // Sangría de 1: Excel no tiene padding y sin esto el texto queda pegado a
  // los filetes ("FACTURA|FECHA"). Es el `px-2` de la imagen.
  const horizontal = e.align ?? "left";
  cell.alignment = { horizontal, vertical: "middle", indent: horizontal === "center" ? 0 : 1 };
  if (e.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: e.fill } };
  if (e.numFmt) cell.numFmt = e.numFmt;
  const border: Partial<ExcelJS.Borders> = {};
  if (e.top) border.top = { style: "thin", color: { argb: e.top } };
  if (e.bottom) border.bottom = { style: "thin", color: { argb: e.bottom } };
  if (e.left) border.left = { style: "thin", color: { argb: e.left } };
  cell.border = border;
}

// Celda con fórmula. El `result` va SIEMPRE resuelto (el mismo número que la
// pantalla): sin él, los visores que no recalculan (Vista previa de Mac,
// Drive, WhatsApp) muestran la celda VACÍA — el gotcha que ya mordió en el
// Excel del maestro.
function formula(cell: ExcelJS.Cell, f: string, result: number | string) {
  cell.value = { formula: f, result } as ExcelJS.CellFormulaValue;
}

// Fecha de un movimiento bancario: se guarda a medianoche UTC (el día de la
// cartola) y la pantalla la lee en UTC. ExcelJS también convierte en UTC, así
// que el día que entra al Excel es el mismo que se ve en pantalla.
function fechaMovimiento(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

// La fecha de la versión llega ya escrita ("16-09-26", ver cuadroResumen.ts).
// Se pasa a fecha de verdad SIN recalcularla: el mismo día que dice la pantalla.
function fechaVersion(s: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

// Un día calendario local (hoy) como medianoche UTC, para que Excel no lo corra.
function diaCalendario(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Folio como número cuando es uno solo (así Excel no marca "número guardado
// como texto" con el triangulito verde); "177/185" queda como texto.
function valorFolio(folio: string | null): string | number | null {
  if (!folio) return null;
  return /^\d+$/.test(folio) ? Number(folio) : folio;
}

export async function buildCuadroResumenXLSX(input: CuadroResumenXLSXInput): Promise<ArrayBuffer> {
  const { data, avance, projectName } = input;
  const { conceptos, pagos, totalAcordado, totalPagado, avanceTotal, versionLabel, anterior } = data;

  // Las MISMAS cuentas que la pantalla (ver cuadroAvance.ts).
  const transferido = sumarTransferido(input.transferencias);
  const calc = calcularAvance(conceptos, avance, transferido);
  const filasPagos = apilarPagos(conceptos, pagos);
  const aCobrarMostrado = totalAPedirMostrado(conceptos, calc);
  const mostrarAnterior = input.mostrarAnterior && anterior !== null;

  const wb = new ExcelJS.Workbook();
  wb.creator = "BLARQ";
  wb.created = new Date();

  // Columnas: A = rótulos; por concepto FECHA · MONTO · FACTURA; al final TOTAL.
  const N = conceptos.length;
  const colFecha = (i: number) => 2 + i * 3;
  const colMonto = (i: number) => 3 + i * 3;
  const colFactura = (i: number) => 4 + i * 3;
  const COL_TOTAL = 2 + N * 3;

  // La hoja NO congela nada ("Inmovilizar paneles"), ni filas ni columnas, a
  // propósito: Excel dibuja el corte como una línea gris que cruza la hoja
  // entera, fuera de la tabla, y MJ lo pidió sacar dos veces. Primero se fue
  // el corte vertical de la columna A, que cruzaba el nombre de la obra y el
  // pie (2026-09-30: "¿por qué sale con esa línea ahí?"); después el
  // horizontal bajo el encabezado de la tabla (2026-10-07), que sí se veía
  // atravesando la hoja de lado a lado. La tabla tiene ~15 filas: fijar el
  // encabezado al bajar no aporta nada que compense esa línea.
  const FILA_H1 = 5;
  const FILA_H2 = 6;
  const ws = wb.addWorksheet("Cuadro Resumen", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    views: [{ showGridLines: false }],
  });

  // Anchos en caracteres, pensados para los montos más largos ("$112.961.833")
  // y los rótulos de la columna A ("AVANCE A COBRAR", "SALDO PENDIENTE").
  // El ancho incluye la sangría de las celdas (ver `aplicar`).
  const ANCHO_TOTAL = 16;
  ws.getColumn(1).width = 20;
  for (let i = 0; i < N; i++) {
    ws.getColumn(colFecha(i)).width = 11;
    ws.getColumn(colMonto(i)).width = 14;
    ws.getColumn(colFactura(i)).width = 10;
  }
  ws.getColumn(COL_TOTAL).width = ANCHO_TOTAL;

  // ─── Encabezado: CUADRO RESUMEN / nombre de la obra · isotipo / fecha ─────
  ws.getRow(1).height = 18;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 24;
  ws.getRow(4).height = 14;

  const tit = ws.getCell(2, 1);
  tit.value = "CUADRO RESUMEN";
  aplicar(tit, { color: GRIS[400], size: 8 });
  const nombre = ws.getCell(3, 1);
  // En pantalla el h1 va en mayúsculas (globals.css).
  nombre.value = projectName.toUpperCase();
  aplicar(nombre, { color: GRIS[900], size: 16 });
  // El mismo rótulo que la pantalla: el cuadro va c/IVA y las cards de arriba
  // del Resumen en neto (ver el comentario en CuadroResumenAvance.tsx).
  const iva = ws.getCell(4, 1);
  iva.value = "Valores con IVA incluido";
  aplicar(iva, { color: GRIS[400], size: 8 });

  const fechaDoc = ws.getCell(3, COL_TOTAL);
  fechaDoc.value = diaCalendario(input.fecha);
  aplicar(fechaDoc, { color: GRIS[400], size: 9, align: "right", numFmt: "dd-mm-yyyy" });

  if (input.isotipoBase64) {
    // 40px de ancho y alineado a la derecha de la columna TOTAL, como en la
    // imagen. El PNG ya viene con la opacidad .55 aplicada
    // (blarq-isotipo-piedra-55.png): Excel no sabe hacer transparencias.
    const imgId = wb.addImage({ base64: input.isotipoBase64, extension: "png" });
    const anchoColPx = ANCHO_TOTAL * 7 + 5;
    ws.addImage(imgId, {
      tl: { col: COL_TOTAL - 1 + (anchoColPx - 40) / anchoColPx, row: 0.3 },
      ext: { width: 40, height: 44 },
    });
  }

  // ─── Encabezado de la tabla, en dos pisos ─────────────────────────────────
  const h1 = ws.getRow(FILA_H1);
  const h2 = ws.getRow(FILA_H2);
  h1.height = 16;
  h2.height = 15;
  aplicar(h1.getCell(1), { fill: BANDA });
  aplicar(h2.getCell(1), { fill: BANDA, bottom: GRIS[300] });
  conceptos.forEach((c, i) => {
    for (let col = colFecha(i); col <= colFactura(i); col++) {
      aplicar(h1.getCell(col), {
        fill: BANDA,
        bold: true,
        color: GRIS[600],
        align: "center",
        left: col === colFecha(i) ? GRIS[200] : undefined,
      });
    }
    h1.getCell(colFecha(i)).value = c.label.toUpperCase();
    ws.mergeCells(FILA_H1, colFecha(i), FILA_H1, colFactura(i));

    const sub: [number, string, "left" | "right"][] = [
      [colFecha(i), "FECHA", "left"],
      [colMonto(i), "MONTO", "right"],
      [colFactura(i), "FACTURA", "right"],
    ];
    for (const [col, txt, align] of sub) {
      const cell = h2.getCell(col);
      cell.value = txt;
      aplicar(cell, {
        fill: BANDA,
        color: GRIS[400],
        size: 8,
        align,
        bottom: GRIS[300],
        left: col === colFecha(i) ? GRIS[100] : undefined,
      });
    }
  });
  h1.getCell(COL_TOTAL).value = "TOTAL";
  aplicar(h1.getCell(COL_TOTAL), { fill: BANDA, bold: true, color: GRIS[600], align: "right", left: GRIS[200] });
  aplicar(h2.getCell(COL_TOTAL), { fill: BANDA, bottom: GRIS[300], left: GRIS[200] });

  let r = FILA_H2 + 1;

  // Pinta una fila entera con el mismo estilo base; `bordeGrupo` es el filete
  // vertical que separa cada concepto (y la columna TOTAL).
  function filaBase(fila: number, base: Estilo, bordeGrupo: string, bordeTotal = bordeGrupo) {
    const row = ws.getRow(fila);
    aplicar(row.getCell(1), base);
    conceptos.forEach((_, i) => {
      aplicar(row.getCell(colFecha(i)), { ...base, left: bordeGrupo });
      aplicar(row.getCell(colMonto(i)), { ...base, align: "right" });
      aplicar(row.getCell(colFactura(i)), { ...base, align: "right" });
    });
    aplicar(row.getCell(COL_TOTAL), { ...base, left: bordeTotal, align: "right" });
    return row;
  }

  // Dónde queda cada fila: las fórmulas de más abajo (y las de la hoja "Me
  // paso a Sueldos") se refieren a estas celdas.
  const dir = (fila: number, col: number) => ws.getCell(fila, col).address;
  const sumaFila = (fila: number, col: (i: number) => number) =>
    `SUM(${conceptos.map((_, i) => dir(fila, col(i))).join(",")})`;
  const filaAcordado = FILA_H2 + 1 + (mostrarAnterior ? 1 : 0);
  const filaPrimerPago = filaAcordado + 1;
  const filaUltimoPago = filaAcordado + filasPagos.length;
  // +1 por la fila de aire entre las transferencias y los totales.
  const filaTotalPagos = filaUltimoPago + 2;
  const filaAvance = filaTotalPagos + 1;
  const filaSaldo = filaAvance + 1;
  // Si el armado de abajo se corre una fila, las fórmulas apuntarían a otra
  // celda sin que nada lo avise: mejor que el Excel no salga.
  const verificarFila = (esperada: number) => {
    if (r !== esperada) throw new Error(`Cuadro Resumen XLSX: fila ${r}, se esperaba ${esperada}`);
  };

  // Lo que se pide en el concepto i: lo que falta para llegar al %, nunca
  // negativo, en pesos enteros (misma cuenta que `calcularAvance`).
  const aPedirExcel = (i: number) => {
    const acordado = dir(filaAcordado, colMonto(i));
    const pagado = dir(filaTotalPagos, colMonto(i));
    return `ROUND(MAX(0,${dir(filaAvance, colFecha(i))}*${acordado}-${pagado}),0)`;
  };

  // ─── Versión ANTERIOR (opcional, si está prendida en pantalla) ────────────
  if (mostrarAnterior) {
    const ant = anterior!;
    const base: Estilo = { color: GRIS[400], bottom: GRIS[100] };
    const row = filaBase(r, base, GRIS[100]);
    row.height = 16;
    row.getCell(1).value = ant.versionLabel;
    conceptos.forEach((c, i) => {
      const cell = row.getCell(colMonto(i));
      cell.value = ant.acordado[c.key];
      cell.numFmt = FMT_MONTO;
      // El guion de "no existía en esa versión" va todavía más tenue.
      if (!(ant.acordado[c.key] > 0)) cell.font = { ...cell.font, color: { argb: GRIS[200] } };
    });
    const tot = row.getCell(COL_TOTAL);
    if (ant.totalComparable) {
      formula(tot, sumaFila(r, colMonto), ant.total);
      tot.numFmt = FMT_MONTO_TOTAL;
    } else {
      // Total no comparable (faltan versiones anteriores de algún concepto):
      // la pantalla deja la celda con guion, no un número que engañe.
      tot.value = "—";
      tot.font = { ...tot.font, color: { argb: GRIS[200] } };
    }
    r++;
  }

  // ─── Acordado (versión vigente) ───────────────────────────────────────────
  verificarFila(filaAcordado);
  {
    const base: Estilo = { color: GRIS[900], bold: true, fill: GRIS[50], bottom: GRIS[200] };
    const row = filaBase(r, base, GRIS[200]);
    row.height = 16;
    row.getCell(1).value = versionLabel;
    conceptos.forEach((c, i) => {
      const f = row.getCell(colFecha(i));
      const dia = fechaVersion(c.fecha);
      f.value = dia;
      aplicar(f, { ...base, bold: false, color: GRIS[500], left: GRIS[200], numFmt: FMT_FECHA });
      const m = row.getCell(colMonto(i));
      m.value = c.acordado;
      m.numFmt = FMT_MONTO;
      if (!(c.acordado > 0)) m.font = { ...m.font, color: { argb: GRIS[300] } };
    });
    const tot = row.getCell(COL_TOTAL);
    formula(tot, sumaFila(r, colMonto), totalAcordado);
    tot.numFmt = FMT_MONTO_TOTAL;
    r++;
  }

  // ─── Transferencias: cada columna de corrido (mismo apilado que pantalla) ─
  filasPagos.forEach((fila, idx) => {
    const base: Estilo = { color: GRIS[700], bottom: GRIS[50] };
    const row = filaBase(r, base, GRIS[100], GRIS[200]);
    row.height = 16;
    if (idx === 0) {
      row.getCell(1).value = "TRANSFERENCIAS";
      aplicar(row.getCell(1), { ...base, color: GRIS[500], size: 8 });
    }
    conceptos.forEach((c, i) => {
      const celda = fila[c.key];
      const f = row.getCell(colFecha(i));
      const m = row.getCell(colMonto(i));
      const fa = row.getCell(colFactura(i));
      if (celda) {
        f.value = fechaMovimiento(celda.date);
        aplicar(f, { ...base, color: GRIS[500], left: GRIS[100], numFmt: FMT_FECHA });
        // Tal cual, sin recortar: TOTAL PAGOS es la suma de esta columna.
        m.value = celda.monto;
        m.numFmt = FMT_MONTO;
        fa.value = valorFolio(celda.folio);
        aplicar(fa, { ...base, color: GRIS[500], align: "right", numFmt: "0" });
      } else {
        // Este concepto tuvo menos pagos que otro: la pantalla muestra un
        // guion suave. Va como texto — no hubo un pago de $0.
        m.value = "—";
        m.font = { ...m.font, color: { argb: GRIS[300] } };
      }
    });
    r++;
  });

  // Aire entre las transferencias y los totales, como en pantalla.
  ws.getRow(r).height = 12;
  r++;

  // ─── TOTAL PAGOS ──────────────────────────────────────────────────────────
  verificarFila(filaTotalPagos);
  {
    const base: Estilo = { color: GRIS[600], bold: true, top: GRIS[300] };
    const row = filaBase(r, base, GRIS[200]);
    row.height = 16;
    row.getCell(1).value = "TOTAL PAGOS";
    conceptos.forEach((c, i) => {
      const acordado = dir(filaAcordado, colMonto(i));
      const pagado = dir(r, colMonto(i));
      const p = row.getCell(colFecha(i));
      // % cobrado = pagado / acordado (0 si no hay acordado, como en pantalla).
      formula(p, `IF(${acordado}>0,${pagado}/${acordado},0)`, c.avancePct);
      aplicar(p, { ...base, bold: false, color: GRIS[500], left: GRIS[200], numFmt: FMT_PCT });
      const m = row.getCell(colMonto(i));
      if (filasPagos.length > 0) {
        formula(
          m,
          `SUM(${dir(filaPrimerPago, colMonto(i))}:${dir(filaUltimoPago, colMonto(i))})`,
          c.pagado
        );
      } else {
        m.value = 0;
      }
      m.numFmt = FMT_MONTO;
      if (!(c.pagado > 0)) m.font = { ...m.font, color: { argb: GRIS[300] } };
      ws.mergeCells(r, colMonto(i), r, colFactura(i));
    });
    const tot = row.getCell(COL_TOTAL);
    formula(tot, sumaFila(r, colMonto), totalPagado);
    tot.numFmt = FMT_MONTO_TOTAL;
    r++;
  }

  // ─── AVANCE A COBRAR — la banda #BFBCB8 ───────────────────────────────────
  verificarFila(filaAvance);
  {
    const base: Estilo = {
      color: GRIS[800],
      bold: true,
      fill: FONDO_AVANCE,
      top: GRIS[400],
      bottom: GRIS[400],
    };
    const row = filaBase(r, base, GRIS[400]);
    row.height = 20;
    row.getCell(1).value = "AVANCE A COBRAR";
    conceptos.forEach((c, i) => {
      const cc = calc.porConcepto.get(c.key)!;
      const p = row.getCell(colFecha(i));
      // El % es DATO (lo que MJ tipeó): se puede cambiar acá y todo lo de
      // abajo se recalcula.
      p.value = (avance[c.key] ?? 0) / 100;
      aplicar(p, { ...base, bold: false, color: GRIS[700], left: GRIS[400], numFmt: FMT_PCT });
      const m = row.getCell(colMonto(i));
      // A cobrar = lo que falta para llegar al %, nunca negativo, en pesos
      // enteros como la pantalla (`calcularAvance` + `hayQuePedir`).
      formula(m, aPedirExcel(i), Math.round(cc.aPedir));
      m.numFmt = FMT_MONTO;
      if (!hayQuePedir(cc.aPedir)) m.font = { ...m.font, bold: false, color: { argb: GRIS[500] } };
      ws.mergeCells(r, colMonto(i), r, colFactura(i));
    });
    const tot = row.getCell(COL_TOTAL);
    formula(tot, sumaFila(r, colMonto), aCobrarMostrado);
    tot.numFmt = FMT_MONTO_TOTAL;
    r++;
  }

  // ─── SALDO PENDIENTE ──────────────────────────────────────────────────────
  verificarFila(filaSaldo);
  {
    const base: Estilo = { color: GRIS[900], top: GRIS[200] };
    const row = filaBase(r, base, GRIS[200]);
    row.height = 16;
    row.getCell(1).value = "SALDO PENDIENTE";
    conceptos.forEach((c, i) => {
      const cc = calc.porConcepto.get(c.key)!;
      const m = row.getCell(colFecha(i));
      // Saldo = acordado − pagado − lo que falta para el %, con ese último SIN
      // redondear: es la cuenta exacta de la pantalla (`saldoNuevo`). Restar
      // la celda de AVANCE (que va en pesos enteros) podía dar $1 distinto.
      const acordado = dir(filaAcordado, colMonto(i));
      const pagado = dir(filaTotalPagos, colMonto(i));
      formula(
        m,
        `MAX(0,${acordado}-${pagado}-MAX(0,${dir(filaAvance, colFecha(i))}*${acordado}-${pagado}))`,
        cc.saldoNuevo
      );
      aplicar(m, { ...base, align: "right", left: GRIS[200], numFmt: FMT_MONTO });
      if (!(cc.saldoNuevo > 0)) m.font = { ...m.font, color: { argb: GRIS[300] } };
      ws.mergeCells(r, colFecha(i), r, colFactura(i));
    });
    const tot = row.getCell(COL_TOTAL);
    formula(tot, sumaFila(r, colFecha), calc.totalSaldoNuevo);
    tot.numFmt = FMT_MONTO_TOTAL;
    r++;
  }

  // ─── Línea del pie, como en pantalla ──────────────────────────────────────
  // (La imagen del cliente no la lleva a propósito; este Excel es de MJ.) El
  // monto que "pedís" es el MISMO total de la fila AVANCE A COBRAR, en pesos
  // enteros — ver el mismo bloque en CuadroResumenAvance.tsx. También es
  // fórmula, para que acompañe si MJ cambia un % en el Excel. FIXED pone los
  // miles con el separador del idioma de quien abre (en español, "46.784.580").
  r++;
  const pie = ws.getCell(r, 1);
  let texto = `Avance total cobrado: ${(avanceTotal * 100).toFixed(0)}% del acordado.`;
  if (aCobrarMostrado > 0) {
    texto += ` Con este avance pedís ${formatCLP(aCobrarMostrado)} y el saldo queda en ${formatCLP(calc.totalSaldoNuevo)}.`;
  }
  const totAcordado = dir(filaAcordado, COL_TOTAL);
  const totPagado = dir(filaTotalPagos, COL_TOTAL);
  const totAvance = dir(filaAvance, COL_TOTAL);
  const totSaldo = dir(filaSaldo, COL_TOTAL);
  formula(
    pie,
    `"Avance total cobrado: "&FIXED(IF(${totAcordado}>0,${totPagado}/${totAcordado},0)*100,0)&"% del acordado."` +
      `&IF(${totAvance}>0," Con este avance pedís $"&FIXED(${totAvance},0)&" y el saldo queda en $"&FIXED(${totSaldo},0)&".","")`,
    texto
  );
  aplicar(pie, { color: GRIS[400], size: 9 });

  ws.pageSetup.printArea = `A1:${ws.getColumn(COL_TOTAL).letter}${r}`;

  // Lo que la hoja de sueldos necesita del cuadro: por concepto, dónde están
  // el acordado, lo pagado y el % de avance.
  const celdasConcepto = new Map(
    conceptos.map((c, i) => [
      c.key,
      {
        acordado: `'${ws.name}'!${dir(filaAcordado, colMonto(i))}`,
        pagado: `'${ws.name}'!${dir(filaTotalPagos, colMonto(i))}`,
        pct: `'${ws.name}'!${dir(filaAvance, colFecha(i))}`,
      },
    ])
  );
  hojaSueldos(wb, conceptos, calc, transferido, input.transferencias, celdasConcepto);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}


// ─── Hoja "Me paso a Sueldos" ────────────────────────────────────────────────
// La misma tabla que la pantalla, más el detalle de las transferencias. Va
// ENGANCHADA a la hoja del cuadro: si MJ cambia un % de avance allá, acá se
// recalculan el % final, lo generado y lo que falta transferir. "Ya
// transferido" suma la lista de traspasos de abajo.
type CeldasConcepto = Map<ConceptoKey, { acordado: string; pagado: string; pct: string }>;

function hojaSueldos(
  wb: ExcelJS.Workbook,
  conceptos: ConceptoCuadro[],
  calc: CalculoAvance,
  transferido: TransferidoPorConcepto,
  transferencias: TransferenciaSueldo[],
  celdas: CeldasConcepto
) {
  const ws = wb.addWorksheet("Me paso a Sueldos", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { width: 20 },
    { width: 18 },
    { width: 11 },
    { width: 16 },
    { width: 17 },
    { width: 17 },
  ];

  const tit = ws.getCell(1, 1);
  tit.value = "ME PASO A SUELDOS";
  aplicar(tit, { bold: true, size: 11 });
  const sub = ws.getCell(2, 1);
  sub.value = "Interno · no va al cliente · solo obra + muebles";
  aplicar(sub, { color: GRIS[400], size: 8 });

  const encabezado = ["CONCEPTO", "UTILIDAD AL 100%", "% AVANCE", "GENERADO", "YA TRANSFERIDO", "FALTA TRANSFERIR"];
  const hr = ws.getRow(4);
  encabezado.forEach((t, i) => {
    const c = hr.getCell(i + 1);
    c.value = t;
    aplicar(c, { fill: BANDA, color: GRIS[500], size: 8, bottom: GRIS[200], align: i === 0 ? "left" : "right" });
  });

  // Filas, calculadas de antemano porque la tabla de arriba suma la lista de
  // traspasos de abajo.
  const conSueldo = conceptos.filter((x) => x.generaSueldo);
  const filaPrimerConcepto = 5;
  const filaTotal = filaPrimerConcepto + conSueldo.length;
  const filaPrimerTraspaso = filaTotal + 5;
  const filaUltimoTraspaso = filaPrimerTraspaso + transferencias.length - 1;
  const hayTraspasos = transferencias.length > 0;
  const rangoConcepto = `$B$${filaPrimerTraspaso}:$B$${filaUltimoTraspaso}`;
  const rangoMonto = `$C$${filaPrimerTraspaso}:$C$${filaUltimoTraspaso}`;

  let r = filaPrimerConcepto;
  for (const c of conSueldo) {
    const cc = calc.porConcepto.get(c.key)!;
    const { acordado, pagado, pct } = celdas.get(c.key)!;
    const row = ws.getRow(r);
    const estilos: Estilo[] = [
      {},
      { color: GRIS[600], align: "right", numFmt: FMT_MONTO_TOTAL },
      { color: GRIS[400], align: "right", numFmt: FMT_PCT },
      { bold: true, align: "right", numFmt: FMT_MONTO_TOTAL },
      { color: GRIS[600], align: "right", numFmt: FMT_MONTO_TOTAL },
      { bold: true, align: "right", numFmt: FMT_MONTO_TOTAL },
    ];
    estilos.forEach((e, i) => aplicar(row.getCell(i + 1), { ...e, bottom: GRIS[50] }));
    row.getCell(1).value = c.key === "obra" ? `${c.label} · GG` : c.label;
    // Utilidad al 100%: DATO (sale del presupuesto, GG de obra / utilidad neta
    // de muebles), no se recalcula acá.
    row.getCell(2).value = c.utilidad100;
    // % final = (pagado + lo que se pide) / acordado — `pctFinal`.
    formula(
      row.getCell(3),
      `IF(${acordado}>0,(${pagado}+MAX(0,${pct}*${acordado}-${pagado}))/${acordado},0)`,
      cc.pctFinal
    );
    // Generado = utilidad × % final, con tope en el 100%.
    formula(row.getCell(4), `MIN(1,C${r})*B${r}`, cc.generado);
    // Ya transferido: los traspasos de la lista marcados con este concepto.
    const etiqueta = c.key === "obra" ? "Obra" : "Muebles";
    if (hayTraspasos) {
      formula(row.getCell(5), `SUMIF(${rangoConcepto},"${etiqueta}",${rangoMonto})`, cc.transferido);
    } else {
      row.getCell(5).value = 0;
    }
    formula(row.getCell(6), `MAX(0,D${r}-E${r})`, cc.faltaTransferir);
    r++;
  }
  {
    const row = ws.getRow(r);
    for (let i = 1; i <= 6; i++) aplicar(row.getCell(i), { bold: true, top: GRIS[200], align: i === 1 ? "left" : "right" });
    row.getCell(1).value = "TOTAL";
    ws.mergeCells(r, 1, r, 3);
    const ultimo = filaTotal - 1;
    formula(row.getCell(4), `SUM(D${filaPrimerConcepto}:D${ultimo})`, calc.generadoTotal);
    // El total transferido incluye lo que está "Sin marcar" (como en
    // pantalla), por eso no es la suma de la columna sino la de la lista.
    if (hayTraspasos) {
      formula(row.getCell(5), `SUM(${rangoMonto})`, totalTransferido(transferido));
    } else {
      row.getCell(5).value = 0;
    }
    // A transferir = generado − TODO lo transferido, nunca negativo.
    formula(row.getCell(6), `MAX(0,D${r}-E${r})`, calc.aTransferir);
    for (const i of [4, 5, 6]) row.getCell(i).numFmt = FMT_MONTO_TOTAL;
    r++;
  }

  if (!hayTraspasos) return;

  // Detalle de "Ya transferido": de qué traspasos está hecho, del más nuevo al
  // más viejo (mismo orden que el desplegable de la pantalla).
  r += 2;
  const tt = ws.getCell(r, 1);
  tt.value = "TRANSFERENCIAS A SUELDOS";
  aplicar(tt, { bold: true, size: 9, color: GRIS[600] });
  r++;
  const hr2 = ws.getRow(r);
  ["FECHA", "CONCEPTO", "MONTO"].forEach((t, i) => {
    aplicar(hr2.getCell(i + 1), { fill: BANDA, color: GRIS[500], size: 8, bottom: GRIS[200], align: i === 2 ? "right" : "left" });
    hr2.getCell(i + 1).value = t;
  });
  r++;
  if (r !== filaPrimerTraspaso) {
    throw new Error(`Me paso a Sueldos XLSX: fila ${r}, se esperaba ${filaPrimerTraspaso}`);
  }
  for (const t of transferencias) {
    const row = ws.getRow(r);
    row.getCell(1).value = fechaMovimiento(t.date);
    aplicar(row.getCell(1), { color: GRIS[600], numFmt: FMT_FECHA, bottom: GRIS[200] });
    const sinMarcar = t.concepto !== "obra" && t.concepto !== "muebles";
    row.getCell(2).value = sinMarcar ? "Sin marcar" : t.concepto === "obra" ? "Obra" : "Muebles";
    // Ámbar = atención (§3): igual que la pastilla "Sin marcar" de la pantalla.
    aplicar(row.getCell(2), { color: sinMarcar ? "FFB45309" : GRIS[600], bottom: GRIS[200] });
    row.getCell(3).value = t.amount;
    aplicar(row.getCell(3), { align: "right", numFmt: FMT_MONTO_TOTAL, bottom: GRIS[200] });
    r++;
  }
  const row = ws.getRow(r);
  for (let i = 1; i <= 3; i++) aplicar(row.getCell(i), { bold: true, top: GRIS[300], align: i === 3 ? "right" : "left" });
  row.getCell(1).value = "TOTAL TRANSFERIDO";
  ws.mergeCells(r, 1, r, 2);
  formula(row.getCell(3), `SUM(${rangoMonto})`, totalTransferido(transferido));
  row.getCell(3).numFmt = FMT_MONTO_TOTAL;
}
