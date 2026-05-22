/**
 * Excel "Cotizacion Maestro": misma data que el PDF Maestro pero como
 * .xlsx editable. El maestro completa P.U. y la columna TOTAL se calcula
 * sola con la formula =Cantidad*P.U. Al pie, una fila TOTAL con SUM.
 *
 * Usa SheetJS (xlsx@0.18). La community edition no soporta estilos al
 * escribir, asi que el archivo sale sin sombreados ni bordes — pero con
 * formulas funcionales (que es lo importante para que el maestro tipee).
 */

import * as XLSX from "xlsx";

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

// Convierte indice 0-based de columna a letra Excel (0 → A, 6 → G).
function colLetter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function buildObraMaestroXLSX(data: ObraMaestroXLSXInput): Buffer {
  const { project, budget, maestro, items } = data;

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: items.filter((i) => i.chapter === key),
    }))
    .filter((ch) => ch.items.length > 0);

  // Filas como array de arrays. La hoja se construye con aoa_to_sheet y
  // despues agregamos formulas a las celdas de TOTAL y la suma final.
  const rows: (string | number | null)[][] = [];

  // Bloque de cabecera del documento.
  rows.push(["BLARQ — COTIZACION MAESTRO"]);
  rows.push([`Version: ${budget.version}`, "", "", "", "", "", `Fecha: ${fmtDate(budget.date)}`]);
  rows.push([`Mandante: ${project.clientName}`]);
  rows.push([`Proyecto: ${project.name}`]);
  rows.push([`Direccion: ${project.address ?? "POR CONFIRMAR"}`]);
  rows.push([`Maestro: ${maestro?.name ?? "—"}`]);
  rows.push([]);
  rows.push([
    "Este documento es el alcance de la obra para cotizacion del maestro.",
  ]);
  rows.push([
    "Complete las columnas P.U. y la columna TOTAL se calcula sola con la formula =Cantidad*P.U.",
  ]);
  rows.push([]);

  // Indice 1-based donde arranca la fila de header de la tabla (en SheetJS
  // las filas son 0-indexed pero las refs de formula son 1-indexed).
  const headerRowIdx = rows.length; // 0-indexed
  rows.push(["ITEM", "PARTIDA", "DESCRIPCION", "UNIDAD", "CANTIDAD", "P.U.", "TOTAL"]);

  // Indices 0-based de columnas para formulas: E=4 (CANTIDAD), F=5 (P.U.), G=6 (TOTAL)
  const COL_QTY = "E";
  const COL_PU = "F";
  const COL_TOTAL = "G";

  // Rastreamos las filas que son items (no chapter, no header) para la
  // suma final del TOTAL.
  const itemRowIndices: number[] = []; // 0-indexed

  for (const ch of chapters) {
    rows.push([`${ch.index}`, ch.label, "", "", "", "", ""]);
    ch.items.forEach((it, idx) => {
      rows.push([
        `${ch.index}.${idx + 1}`,
        it.name,
        it.descriptionMaestro ?? it.descriptionCliente ?? "",
        it.unit,
        it.quantity,
        null, // P.U. vacio para que el maestro tipee
        null, // TOTAL — se llena con formula despues
      ]);
      itemRowIndices.push(rows.length - 1);
    });
  }

  // Fila TOTAL al final con SUM.
  const totalRowIdx = rows.length; // 0-indexed
  rows.push(["", "", "", "", "", "TOTAL", null]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Inyectar formulas. SheetJS preserva la formula en el archivo solo si
  // la celda tiene `t: "n"` + `v: 0` (cache de resultado) + `f`. Sin el
  // `v`, el writer descarta la celda. Excel recalcula al abrir igual.
  for (const i of itemRowIndices) {
    const r = i + 1; // 1-indexed para refs de Excel
    const totalCellRef = `${COL_TOTAL}${r}`;
    ws[totalCellRef] = {
      t: "n",
      v: 0,
      f: `${COL_QTY}${r}*${COL_PU}${r}`,
    };
  }

  // Suma del TOTAL.
  if (itemRowIndices.length > 0) {
    const firstR = itemRowIndices[0] + 1;
    const lastR = itemRowIndices[itemRowIndices.length - 1] + 1;
    const totalSumRef = `${COL_TOTAL}${totalRowIdx + 1}`;
    ws[totalSumRef] = {
      t: "n",
      v: 0,
      f: `SUM(${COL_TOTAL}${firstR}:${COL_TOTAL}${lastR})`,
    };
  }

  // Anchos de columna razonables.
  ws["!cols"] = [
    { wch: 7 },  // ITEM
    { wch: 32 }, // PARTIDA
    { wch: 60 }, // DESCRIPCION
    { wch: 8 },  // UNIDAD
    { wch: 10 }, // CANTIDAD
    { wch: 12 }, // P.U.
    { wch: 14 }, // TOTAL
  ];

  // Merge del titulo superior a lo ancho de la tabla.
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, // titulo
    { s: { r: 7, c: 0 }, e: { r: 7, c: 6 } }, // nota 1
    { s: { r: 8, c: 0 }, e: { r: 8, c: 6 } }, // nota 2
  ];

  // Actualizar `!ref` para que abarque las filas/cols que escribimos
  // explicitamente (las formulas que agregamos no quedan en el rango
  // que aoa_to_sheet calcula).
  const lastCol = colLetter(6);
  const lastRow = totalRowIdx + 1;
  ws["!ref"] = `A1:${lastCol}${lastRow}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cotizacion");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}
