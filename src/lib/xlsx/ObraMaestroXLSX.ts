/**
 * Excel "Cotizacion Maestro": misma data y look del PDF Maestro, como
 * .xlsx editable. El maestro completa la columna P.U. y la columna
 * TOTAL se recalcula sola con `=Cantidad*P.U.` Al pie, una fila TOTAL
 * con SUM.
 *
 * Usa ExcelJS (no SheetJS) porque necesitamos estilos: logo BLARQ,
 * sombreados grises en headers/capitulos/sub-chapters, bordes finos
 * en cada fila, fuentes bold/italic, etc. SheetJS community no soporta
 * estilos al escribir.
 */

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const PROFESSIONAL = "JOSE TOMAS LARRAIN";

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "DEMOLICIONES", index: 1 },
  reparaciones: { label: "REPARACIONES", index: 2 },
  electricas: { label: "INSTALACIONES ELECTRICAS", index: 3 },
  sanitarias: { label: "INSTALACIONES SANITARIAS Y GASFITERIA", index: 4 },
  terminaciones: { label: "TERMINACIONES", index: 5 },
  limpieza: { label: "ASEO Y LIMPIEZA", index: 6 },
};

export interface ObraMaestroXLSXItemInput {
  chapter: string;
  subChapter: string | null;
  name: string;
  descriptionMaestro: string | null;
  descriptionCliente: string | null;
  unit: string;
  quantity: number;
}

export interface ObraMaestroXLSXInput {
  project: { name: string; clientName: string; address: string | null };
  budget: { version: string; date: string | Date };
  maestro: { name: string | null } | null;
  items: ObraMaestroXLSXItemInput[];
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function loadLogoBuffer(): Buffer | null {
  const logoPath = path.join(
    process.cwd(),
    "public",
    "assets",
    "logo-blarq.png"
  );
  try {
    return fs.readFileSync(logoPath);
  } catch {
    return null;
  }
}

// ─── Estilos base (todos en escala de grises, match BLARQ) ──────────────
const BORDER_THIN_BLACK: Partial<ExcelJS.Borders> = {
  bottom: { style: "thin", color: { argb: "FF000000" } },
};
const BORDER_TOP_BOTTOM_BLACK: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
};
const FILL_GRAY_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFDBDBDB" },
};
const FILL_GRAY_SUBCHAPTER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

export async function buildObraMaestroXLSX(
  data: ObraMaestroXLSXInput
): Promise<Buffer> {
  const { project, budget, maestro, items } = data;

  // Ordenar items por subChapter (los sin sub-chapter primero), despues
  // por nombre. Espejo del PDF.
  const sortItemsBySubChapter = (
    a: ObraMaestroXLSXItemInput,
    b: ObraMaestroXLSXItemInput
  ) => {
    const aSub = a.subChapter ?? "";
    const bSub = b.subChapter ?? "";
    if (aSub !== bSub) return aSub.localeCompare(bSub, "es");
    return a.name.localeCompare(b.name, "es");
  };

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: items.filter((i) => i.chapter === key).sort(sortItemsBySubChapter),
    }))
    .filter((ch) => ch.items.length > 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "BLARQ";
  wb.created = new Date();
  const ws = wb.addWorksheet("Cotizacion", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    properties: { defaultRowHeight: 14 },
    views: [{ showGridLines: false }],
  });

  // Anchos de columna espejando el PDF (5/19/40/5/8/10/13 %).
  // En Excel los anchos son en caracteres aproximados.
  ws.columns = [
    { width: 6 },   // A — ITEM
    { width: 30 },  // B — PARTIDA
    { width: 55 },  // C — DESCRIPCION
    { width: 8 },   // D — UNIDAD
    { width: 10 },  // E — CANTIDAD
    { width: 13 },  // F — P.U.
    { width: 16 },  // G — TOTAL
  ];

  // ─── Header BLARQ ─────────────────────────────────────────────────────
  // Filas 1-4 izquierda: logo (filas 1-3 cols A-B) + 3 fields debajo.
  // Filas 1-4 derecha: Version/Title (fila 1-2 cols E-G), profesional/maestro/fecha (filas 3-5 cols E-G).
  // Layout simple, evitamos exagerar — Excel no es PDF.

  const logoBuf = loadLogoBuffer();
  if (logoBuf) {
    const imgId = wb.addImage({ buffer: logoBuf as unknown as ArrayBuffer, extension: "png" });
    // tl = top-left (col, row 0-indexed). br = bottom-right.
    // Posicionamos el logo en A1, ocupando aprox 2 cols x 3 filas.
    ws.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: 110, height: 38 },
    });
  }

  ws.getRow(1).height = 16;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 16;

  // Bloque derecha — Version / Title arriba
  ws.mergeCells("E1:G1");
  ws.getCell("E1").value = "Version:";
  ws.getCell("E1").font = { name: "Calibri", size: 8, color: { argb: "FF404040" } };
  ws.getCell("E1").alignment = { horizontal: "right", vertical: "middle" };

  ws.mergeCells("E2:G2");
  ws.getCell("E2").value = `${budget.version} COTIZACION`;
  ws.getCell("E2").font = { name: "Calibri", size: 16, color: { argb: "FF808080" }, bold: false };
  ws.getCell("E2").alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(2).height = 22;

  ws.mergeCells("E3:G3");
  ws.getCell("E3").value = "MAESTRO — OBRA";
  ws.getCell("E3").font = { name: "Calibri", size: 9, color: { argb: "FF808080" }, bold: true };
  ws.getCell("E3").alignment = { horizontal: "right", vertical: "middle" };

  // ─── Bloque de campos: izquierda Mandante/Proyecto/Direccion · derecha Profesional/Maestro/Fecha
  type FieldRow = { row: number; leftLabel: string; leftValue: string; rightLabel: string; rightValue: string };
  const fields: FieldRow[] = [
    { row: 5, leftLabel: "MANDANTE",  leftValue: project.clientName,
      rightLabel: "PROFESIONAL A CARGO", rightValue: PROFESSIONAL },
    { row: 6, leftLabel: "PROYECTO",  leftValue: project.name,
      rightLabel: "MAESTRO",             rightValue: maestro?.name ?? "—" },
    { row: 7, leftLabel: "DIRECCION", leftValue: project.address ?? "POR CONFIRMAR",
      rightLabel: "FECHA",               rightValue: fmtDate(budget.date) },
  ];
  for (const f of fields) {
    // Izquierda: label en A, value en B-C (merge)
    ws.getCell(`A${f.row}`).value = f.leftLabel;
    ws.getCell(`A${f.row}`).font = { name: "Calibri", size: 8, color: { argb: "FF808080" } };
    ws.mergeCells(`B${f.row}:C${f.row}`);
    ws.getCell(`B${f.row}`).value = f.leftValue;
    ws.getCell(`B${f.row}`).font = { name: "Calibri", size: 9, bold: true };

    // Derecha: label en D-E (merge), value en F-G (merge)
    ws.mergeCells(`D${f.row}:E${f.row}`);
    ws.getCell(`D${f.row}`).value = f.rightLabel;
    ws.getCell(`D${f.row}`).font = { name: "Calibri", size: 8, color: { argb: "FF808080" } };
    ws.getCell(`D${f.row}`).alignment = { horizontal: "right" };
    ws.mergeCells(`F${f.row}:G${f.row}`);
    ws.getCell(`F${f.row}`).value = f.rightValue;
    ws.getCell(`F${f.row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.getCell(`F${f.row}`).alignment = { horizontal: "right" };
  }

  // ─── Nota explicativa ─────────────────────────────────────────────────
  ws.mergeCells("A9:G9");
  ws.getCell("A9").value =
    "Este documento es el alcance de la obra para cotizacion del maestro. Complete la columna P.U.; el TOTAL se calcula solo.";
  ws.getCell("A9").font = { name: "Calibri", size: 8, italic: true, color: { argb: "FF555555" } };
  ws.getCell("A9").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  ws.getRow(9).height = 18;

  // ─── Header de tabla ──────────────────────────────────────────────────
  const HEADER_ROW = 11;
  const headerLabels = ["ITEM", "PARTIDA", "DESCRIPCION", "UNIDAD", "CANTIDAD", "P.U.", "TOTAL"];
  for (let i = 0; i < headerLabels.length; i++) {
    const cell = ws.getRow(HEADER_ROW).getCell(i + 1);
    cell.value = headerLabels[i];
    cell.font = { name: "Calibri", size: 9, bold: true };
    cell.fill = FILL_GRAY_HEADER;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER_TOP_BOTTOM_BLACK;
  }
  ws.getRow(HEADER_ROW).height = 18;

  // ─── Filas: capitulos + sub-chapters + items ─────────────────────────
  // Track row indexes (1-based) de los items para formula y SUM final.
  const itemRowIndices: number[] = [];

  let currentRow = HEADER_ROW + 1;
  for (const ch of chapters) {
    // Fila de capitulo (todo gris oscuro, en bold uppercase)
    const chRow = ws.getRow(currentRow);
    chRow.getCell(1).value = ch.index;
    chRow.getCell(2).value = ch.label;
    for (let c = 1; c <= 7; c++) {
      const cell = chRow.getCell(c);
      cell.font = { name: "Calibri", size: 9, bold: true };
      cell.fill = FILL_GRAY_HEADER;
      cell.border = BORDER_THIN_BLACK;
      cell.alignment = c === 1
        ? { horizontal: "center", vertical: "middle" }
        : { horizontal: "left", vertical: "middle" };
    }
    chRow.height = 16;
    currentRow++;

    let prevSub: string | null | undefined = undefined;
    ch.items.forEach((it, idx) => {
      // Fila separadora de sub-chapter si cambio
      if (it.subChapter && it.subChapter !== prevSub) {
        const subRow = ws.getRow(currentRow);
        subRow.getCell(2).value = it.subChapter;
        for (let c = 1; c <= 7; c++) {
          const cell = subRow.getCell(c);
          cell.font = { name: "Calibri", size: 9, italic: true, bold: true, color: { argb: "FF404040" } };
          cell.fill = FILL_GRAY_SUBCHAPTER;
          cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
          cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical: "middle" };
        }
        subRow.height = 15;
        currentRow++;
      }
      prevSub = it.subChapter;

      // Fila de item
      const itRow = ws.getRow(currentRow);
      itRow.getCell(1).value = `${ch.index}.${idx + 1}`;
      itRow.getCell(2).value = it.name;
      itRow.getCell(3).value = it.descriptionMaestro ?? it.descriptionCliente ?? "";
      itRow.getCell(4).value = it.unit;
      itRow.getCell(5).value = it.quantity;
      // Col F (P.U.) la dejamos vacia para que el maestro tipee.
      // Col G (TOTAL) lleva la formula =E*F.
      itRow.getCell(7).value = { formula: `E${currentRow}*F${currentRow}`, result: 0 } as ExcelJS.CellFormulaValue;

      // Estilos por columna
      const fontBase = { name: "Calibri" as const, size: 9 };
      itRow.getCell(1).font = { ...fontBase };
      itRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      itRow.getCell(2).font = { ...fontBase, bold: true };
      itRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      itRow.getCell(3).font = { ...fontBase, size: 8, color: { argb: "FF555555" } };
      itRow.getCell(3).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      itRow.getCell(4).font = { ...fontBase };
      itRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      itRow.getCell(5).font = { ...fontBase };
      itRow.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      itRow.getCell(5).numFmt = "#,##0.##";
      itRow.getCell(6).font = { ...fontBase };
      itRow.getCell(6).alignment = { horizontal: "right", vertical: "middle" };
      itRow.getCell(6).numFmt = '"$"#,##0';
      itRow.getCell(7).font = { ...fontBase, bold: true };
      itRow.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
      itRow.getCell(7).numFmt = '"$"#,##0';

      // Borde inferior gris claro en todas las celdas del item
      for (let c = 1; c <= 7; c++) {
        itRow.getCell(c).border = {
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      }

      itemRowIndices.push(currentRow);
      currentRow++;
    });
  }

  // ─── Fila TOTAL al pie ───────────────────────────────────────────────
  const totalRow = ws.getRow(currentRow);
  ws.mergeCells(`A${currentRow}:F${currentRow}`);
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(1).font = { name: "Calibri", size: 10, bold: true };
  totalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(1).border = BORDER_TOP_BOTTOM_BLACK;

  if (itemRowIndices.length > 0) {
    const firstR = itemRowIndices[0];
    const lastR = itemRowIndices[itemRowIndices.length - 1];
    totalRow.getCell(7).value = {
      formula: `SUM(G${firstR}:G${lastR})`,
      result: 0,
    } as ExcelJS.CellFormulaValue;
  } else {
    totalRow.getCell(7).value = 0;
  }
  totalRow.getCell(7).font = { name: "Calibri", size: 10, bold: true };
  totalRow.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(7).numFmt = '"$"#,##0';
  totalRow.getCell(7).border = BORDER_TOP_BOTTOM_BLACK;
  totalRow.height = 20;

  // ─── Print area + zoom ───────────────────────────────────────────────
  ws.pageSetup.printArea = `A1:G${currentRow}`;
  ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
