/**
 * Excel de las rendiciones de gastos de los socios, para el contador.
 *
 * Una hoja por socio. Ordenado POR REEMBOLSO (decidido con MJ): cada
 * transferencia de BLARQ al socio en una fila, y debajo los documentos que
 * respalda, con obra y categoría. Tres columnas de plata que se pueden sumar:
 *   - "Rendido": lo que cada documento respalda del reembolso,
 *   - "Reembolsado": la transferencia (solo en la fila del reembolso),
 *   - "Sin respaldo": lo que de esa transferencia todavía no tiene documento.
 * Por reembolso, Reembolsado = Rendido + Sin respaldo. Al final, los totales
 * con fórmulas (con su valor escrito, ver CartolaConciliadaXLSX).
 *
 * NO CALCULA NADA PROPIO: pinta lo que arma `armarRendiciones`
 * (lib/contabilidad/rendiciones.ts), lo mismo que el PDF.
 */

import ExcelJS from "exceljs";
import type { RendicionSocio, Rendiciones } from "@/lib/contabilidad/rendiciones";

const GRIS = {
  100: "FFEEEDEC",
  300: "FFCFCBC5",
  400: "FFA9A093",
  500: "FF8A7F6F",
  600: "FF655D51",
  900: "FF2A2722",
} as const;
const BANDA = "FFEDEDEC";
const AMBAR = "FF92400E";
const FUENTE = "Calibri";
const FMT_MONTO = '"$"#,##0;-"$"#,##0;"$"0';
const FMT_FECHA = "dd-mm-yyyy";
const BLARQ_RUT = "77.270.733-9";

type Estilo = {
  color?: string;
  bold?: boolean;
  size?: number;
  italic?: boolean;
  fill?: string;
  align?: "left" | "right";
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
  cell.alignment = { horizontal: e.align ?? "left", vertical: "top", indent: 1 };
  if (e.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: e.fill } };
  if (e.numFmt) cell.numFmt = e.numFmt;
  if (e.bottom) cell.border = { bottom: { style: "thin", color: { argb: e.bottom } } };
}

// El result va SIEMPRE resuelto: sin él, los visores que no recalculan
// muestran la celda vacía.
function formula(cell: ExcelJS.Cell, f: string, result: number) {
  cell.value = { formula: f, result } as ExcelJS.CellFormulaValue;
}

function valorFolio(folio: string | null): string | number | null {
  if (!folio) return null;
  return /^\d{1,15}$/.test(folio) ? Number(folio) : folio;
}

const COLS = [
  { t: "Reembolso", w: 12 },
  { t: "Cuenta", w: 10 },
  { t: "Fecha documento", w: 12 },
  { t: "Documento", w: 16 },
  { t: "Folio", w: 12 },
  { t: "RUT", w: 13 },
  { t: "Proveedor", w: 34 },
  { t: "Obra", w: 22 },
  { t: "Categoría", w: 24 },
  { t: "Total documento", w: 14 },
  { t: "Rendido", w: 13 },
  { t: "Reembolsado", w: 13 },
  { t: "Sin respaldo", w: 13 },
];
const C = {
  reembolso: 1, cuenta: 2, fechaDoc: 3, documento: 4, folio: 5, rut: 6, proveedor: 7,
  obra: 8, categoria: 9, total: 10, rendido: 11, reembolsado: 12, sinRespaldo: 13,
} as const;
const MONTOS = new Set<number>([C.total, C.rendido, C.reembolsado, C.sinRespaldo]);

// Excel no acepta ciertos caracteres en el nombre de una hoja y corta en 31.
function nombreHoja(s: string): string {
  return s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function hojaSocio(wb: ExcelJS.Workbook, r: Rendiciones, s: RendicionSocio) {
  const ws = wb.addWorksheet(nombreHoja(s.socio), {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));

  const t1 = ws.getRow(1).getCell(1);
  t1.value = `BLARQ SpA · RUT ${BLARQ_RUT}`;
  aplicar(t1, { size: 8, color: GRIS[500] });
  const t2 = ws.getRow(2).getCell(1);
  t2.value = `Rendición de gastos · ${s.socio} · ${r.periodo}`;
  aplicar(t2, { size: 14, bold: true });
  ws.getRow(2).height = 22;
  const t3 = ws.getRow(3).getCell(1);
  t3.value =
    `${s.rut ? `RUT ${s.rut}. ` : ""}Compras de BLARQ que pagó con su plata y que BLARQ le reembolsó, ` +
    "con los documentos que respaldan cada reembolso.";
  aplicar(t3, { size: 9, italic: true, color: GRIS[600] });

  const FILA_ENC = 5;
  const enc = ws.getRow(FILA_ENC);
  COLS.forEach((c, i) => {
    const cell = enc.getCell(i + 1);
    cell.value = c.t;
    aplicar(cell, {
      bold: true,
      size: 8,
      color: GRIS[600],
      fill: BANDA,
      align: MONTOS.has(i + 1) ? "right" : "left",
      bottom: GRIS[300],
    });
  });
  enc.height = 18;

  let fila = FILA_ENC + 1;
  if (s.reembolsos.length === 0) {
    const c = ws.getRow(fila).getCell(1);
    c.value = `Sin reembolsos en ${r.periodo}.`;
    aplicar(c, { italic: true, color: GRIS[500] });
    return;
  }

  const primera = fila;
  for (const re of s.reembolsos) {
    // Fila del reembolso: la transferencia de BLARQ al socio.
    const head = ws.getRow(fila);
    head.getCell(C.reembolso).value = re.fecha;
    head.getCell(C.cuenta).value = re.cuenta;
    head.getCell(C.documento).value = "Transferencia";
    head.getCell(C.proveedor).value = re.descripcion;
    head.getCell(C.reembolsado).value = re.monto;
    head.getCell(C.sinRespaldo).value = re.sinRespaldo;
    for (let k = 1; k <= COLS.length; k++) {
      aplicar(head.getCell(k), {
        bold: k !== C.proveedor,
        numFmt: k === C.reembolso ? FMT_FECHA : MONTOS.has(k) ? FMT_MONTO : undefined,
        align: MONTOS.has(k) ? "right" : "left",
        color: k === C.sinRespaldo && re.sinRespaldo > 0 ? AMBAR : k === C.proveedor ? GRIS[600] : GRIS[900],
      });
    }
    fila += 1;

    re.lineas.forEach((l, i) => {
      const row = ws.getRow(fila);
      const ultima = i === re.lineas.length - 1 && !re.nota;
      // La fecha del reembolso se repite en gris: un filtro por fecha no
      // separa los documentos de su transferencia.
      row.getCell(C.reembolso).value = re.fecha;
      row.getCell(C.fechaDoc).value = l.fechaDocumento;
      row.getCell(C.documento).value = l.documento;
      row.getCell(C.folio).value = valorFolio(l.folio);
      row.getCell(C.rut).value = l.rut;
      row.getCell(C.proveedor).value = l.proveedor;
      row.getCell(C.obra).value = l.obra;
      row.getCell(C.categoria).value = l.categoria;
      row.getCell(C.total).value = l.totalDocumento;
      row.getCell(C.rendido).value = l.rendido;
      for (let k = 1; k <= COLS.length; k++) {
        aplicar(row.getCell(k), {
          color: k === C.reembolso ? GRIS[400] : k === C.total ? GRIS[600] : GRIS[900],
          numFmt: k === C.reembolso || k === C.fechaDoc ? FMT_FECHA : MONTOS.has(k) ? FMT_MONTO : undefined,
          align: MONTOS.has(k) ? "right" : "left",
          bottom: ultima ? GRIS[100] : undefined,
        });
      }
      fila += 1;
    });

    if (re.nota) {
      const row = ws.getRow(fila);
      row.getCell(C.reembolso).value = re.fecha;
      row.getCell(C.documento).value = "Nota";
      row.getCell(C.proveedor).value = re.nota.replace(/\s*\n\s*/g, " / ");
      for (let k = 1; k <= COLS.length; k++) {
        aplicar(row.getCell(k), {
          color: k === C.reembolso ? GRIS[400] : AMBAR,
          italic: k !== C.reembolso,
          numFmt: k === C.reembolso ? FMT_FECHA : undefined,
          bottom: GRIS[100],
        });
      }
      fila += 1;
    }
  }
  const ultima = fila - 1;
  ws.autoFilter = { from: { row: FILA_ENC, column: 1 }, to: { row: ultima, column: COLS.length } };

  // ── Totales, con fórmulas ──
  fila += 1;
  const totales: [string, number, number][] = [
    ["Rendido con documentos", C.rendido, s.respaldado],
    ["Reembolsado por BLARQ", C.reembolsado, s.total],
    ["Sin respaldo todavía", C.sinRespaldo, s.sinRespaldo],
  ];
  for (const [rotulo, col, valor] of totales) {
    const row = ws.getRow(fila);
    row.getCell(C.categoria).value = rotulo;
    aplicar(row.getCell(C.categoria), { bold: true, align: "right" });
    const letra = ws.getColumn(col).letter;
    formula(row.getCell(col), `SUM(${letra}${primera}:${letra}${ultima})`, valor);
    aplicar(row.getCell(col), {
      bold: true,
      numFmt: FMT_MONTO,
      align: "right",
      color: col === C.sinRespaldo && valor > 0 ? AMBAR : GRIS[900],
    });
    fila += 1;
  }

  ws.pageSetup.printArea = `A1:${ws.getColumn(COLS.length).letter}${fila}`;
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws.pageSetup.printTitlesRow = `${FILA_ENC}:${FILA_ENC}`;
}

export async function buildRendicionesXLSX(r: Rendiciones): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BLARQ";
  wb.created = new Date();
  for (const s of r.socios) hojaSocio(wb, r, s);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
