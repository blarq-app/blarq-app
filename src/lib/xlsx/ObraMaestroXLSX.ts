/**
 * Excel "Cotizacion Maestro": misma data y look del PDF Maestro, como
 * .xlsx editable. Sale en DOS versiones, segun `conPrecios`:
 *   - SIN precios (default): la columna P.U. va vacia para que el maestro la
 *     complete, y TOTAL se recalcula sola con `=Cantidad*P.U.`
 *   - CON precios: P.U. viene con la MANO DE OBRA acordada ya escrita
 *     (`ObraItem.costLabor`, que es unitaria), y TOTAL con el resultado ya
 *     calculado. Es el documento de cuando el trato esta cerrado.
 * En las dos, al pie una fila TOTAL con SUM.
 *
 * OJO — el precio que va es SIEMPRE `costLabor` (lo que BLARQ le paga al
 * maestro), NUNCA el `unitPrice` del cliente: la diferencia entre los dos es
 * material y margen de BLARQ.
 *
 * Las formulas se guardan con su `result` ya resuelto para que el numero se
 * vea al abrir el archivo aunque el visor no recalcule (Vista previa de Mac,
 * Drive, etc.) — nunca un `#REF` ni una celda en blanco.
 *
 * Usa ExcelJS (no SheetJS) porque necesitamos estilos: logo BLARQ,
 * sombreados grises en headers/capitulos/sub-chapters, bordes finos
 * en cada fila, fuentes bold/italic, etc. SheetJS community no soporta
 * estilos al escribir.
 *
 * DESCRIPCIONES — la columna sale de `descriptionMaestro` y de nada más. Hasta
 * 2026-08-15 intentaba heredar `descriptionCliente` cuando la del maestro
 * estaba vacía (un `??` que además nunca se disparaba, porque el editor guarda
 * `""` y no `null`). Decidido con MJ que la herencia se va: las dos
 * descripciones dicen cosas distintas — la del cliente trae condiciones
 * comerciales, precios de provisión y notas internas ("SE PONE VALOR PROFORMA
 * PARA NO TENERLO EN 0") que no van en el alcance de un maestro, y la copia
 * silenciosa habría afectado 358 partidas sin que nadie las revisara. Lo que no
 * esté escrito para el maestro sale vacío, a propósito.
 */

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { groupByChapter, type ChapterLike } from "@/lib/presupuesto/chapters";
import { annotateZones } from "@/lib/presupuesto/zones";
import { richTextToPlainText } from "@/lib/richText";

const PROFESSIONAL = "JOSE TOMAS LARRAIN";

export interface ObraMaestroXLSXItemInput {
  chapterId: string | null;
  subChapter: string | null;
  // Orden manual (el que arma MJ arrastrando en la cotizacion). El Excel
  // respeta ESTE orden, igual que el PDF.
  sortOrder: number;
  name: string;
  descriptionMaestro: string | null;
  unit: string;
  quantity: number;
  // Mano de obra UNITARIA que BLARQ le paga al maestro. Solo se escribe
  // cuando `conPrecios` esta prendido.
  costLabor: number | null;
}

export interface ObraMaestroXLSXInput {
  project: { name: string; clientName: string; address: string | null };
  budget: { version: string; date: string | Date };
  maestro: { name: string | null } | null;
  chapters: ChapterLike[];
  items: ObraMaestroXLSXItemInput[];
  // false/undefined = para cotizar (P.U. vacia). true = con la mano de obra
  // acordada ya escrita.
  conPrecios?: boolean;
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
  const conPrecios = data.conPrecios === true;

  // Capitulos en el MISMO orden y numeracion que la cotizacion (helper
  // compartido lib/presupuesto/chapters.ts, con reflow saltando vacios).
  // Partidas en orden de sortOrder (el orden manual de MJ), NO alfabetico.
  // Espejo del PDF.
  const chapters = groupByChapter(data.chapters, items).map((g) => ({
    key: g.chapter.id,
    label: g.chapter.name,
    items: g.items,
    index: g.index ?? 0,
  }));

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
  ws.getCell("E3").value = conPrecios
    ? "MAESTRO — OBRA · CON PRECIOS"
    : "MAESTRO — OBRA";
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
  ws.getCell("A9").value = conPrecios
    ? "Este documento es el alcance de la obra con los precios de mano de obra acordados. P.U. es el precio unitario de mano de obra; el TOTAL es P.U. por la cantidad. No incluye materiales."
    : "Este documento es el alcance de la obra para cotizacion del maestro. Complete la columna P.U.; el TOTAL se calcula solo.";
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
  // Suma de la mano de obra acordada (0 en la version sin precios). Sirve para
  // dejar resuelto el `result` del SUM de la fila TOTAL.
  let totalManoObra = 0;

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

    // Zona DERIVADA por posicion (helper compartido): una partida sin zona
    // hereda la de arriba. El encabezado va en la primera partida de cada zona.
    const zoneRows = annotateZones(ch.items.map((i) => ({ ...i, total: 0 }))).rows;
    zoneRows.forEach((row, idx) => {
      const it = row.item;
      // Fila separadora de sub-chapter al empezar una zona
      if (row.isZoneStart) {
        const subRow = ws.getRow(currentRow);
        subRow.getCell(2).value = row.zone;
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

      // Fila de item
      const itRow = ws.getRow(currentRow);
      itRow.getCell(1).value = `${ch.index}.${idx + 1}`;
      itRow.getCell(2).value = it.name;
      // SOLO la descripción del maestro. Si está vacía, la celda va vacía: NO
      // se hereda la del cliente. Ver la nota en el encabezado del archivo.
      // Texto plano: la celda de Excel no interpreta las etiquetas del editor.
      itRow.getCell(3).value = richTextToPlainText(it.descriptionMaestro);
      itRow.getCell(4).value = it.unit;
      // Redondeada a 2 decimales, igual que el PDF. Va como NUMERO (no texto)
      // porque la columna TOTAL la multiplica; y redondeada, para que al
      // maestro le calce la cuenta con lo que ve escrito.
      const qty = Math.round(it.quantity * 100) / 100;
      itRow.getCell(5).value = qty;
      // Col F (P.U.): vacia para que el maestro tipee, o la mano de obra
      // acordada (redondeada a peso, como se paga).
      // Col G (TOTAL): siempre la formula =E*F, asi sigue viva si alguien
      // corrige una cantidad. El `result` va resuelto para que el numero se
      // vea aunque el visor no recalcule.
      const puManoObra = conPrecios ? Math.round(it.costLabor ?? 0) : 0;
      if (conPrecios) itRow.getCell(6).value = puManoObra;
      itRow.getCell(7).value = {
        formula: `E${currentRow}*F${currentRow}`,
        result: Math.round(qty * puManoObra),
      } as ExcelJS.CellFormulaValue;
      totalManoObra += Math.round(qty * puManoObra);

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
      // El formato se elige por celda porque Excel no sabe decir "decimales
      // solo si existen": el separador decimal se dibuja siempre que esté en
      // el patrón, aunque los decimales sean opcionales (`##`) — por eso un
      // `#,##0.##` fijo mostraba las cantidades enteras como "172,", con la
      // coma colgando. Tampoco sirve "General", que saca la coma pero se lleva
      // puesto el punto de los miles (13000 en vez de 13.000). Con el ternario
      // cada cantidad lleva el patrón que le corresponde: "13.000" y "172" las
      // enteras, "28,2" y "12,25" las que tienen decimales.
      itRow.getCell(5).numFmt = Number.isInteger(qty) ? "#,##0" : "#,##0.##";
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
  totalRow.getCell(1).value = conPrecios ? "TOTAL MANO DE OBRA" : "TOTAL";
  totalRow.getCell(1).font = { name: "Calibri", size: 10, bold: true };
  totalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(1).border = BORDER_TOP_BOTTOM_BLACK;

  if (itemRowIndices.length > 0) {
    const firstR = itemRowIndices[0];
    const lastR = itemRowIndices[itemRowIndices.length - 1];
    totalRow.getCell(7).value = {
      formula: `SUM(G${firstR}:G${lastR})`,
      result: totalManoObra,
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
