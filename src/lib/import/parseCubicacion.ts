/**
 * Parser de Excel "cubicación" entregado por JP.
 *
 * Estructura del Excel (hoja CUBICACION):
 *   - Header del documento en filas 0-17 (Mandante, Proyecto, etc).
 *   - Headers de tabla en alguna fila intermedia: ITEM | PARTIDA |
 *     DESCRIPCION | UNIDAD | CANTIDAD (en columnas 2-7 aprox).
 *   - Después filas de chapter (ej. "1" "DEMOLICIONES"), filas de
 *     sub-chapter (ej. solo "COCINA"), filas de ítem (ej. "1.1"
 *     "RETIRO MOBILIARIO COCINA" "CONSIDERA…" "GL" "1").
 *
 * No tiene precios — solo cantidades. JP es el que cubica, MJ después
 * matchea contra el catálogo de la app.
 */

import * as XLSX from "xlsx";

const CHAPTER_MAPPING: Record<string, string> = {
  DEMOLICIONES: "demoliciones",
  DEMOLICION: "demoliciones",
  "OBRA GRUESA": "obra_gruesa",
  REPARACIONES: "reparaciones",
  "INSTALACIONES SANITARIAS": "sanitarias",
  "INSTALACIONES ELECTRICAS": "electricas",
  TERMINACIONES: "terminaciones",
  ADICIONALES: "adicionales",
  "LIMPIEZA Y ASEO": "limpieza",
  "ASEO Y LIMPIEZA": "limpieza",
  "INSTALACIONES GAS": "sanitarias",
  "INSTALACIONES SANITARIAS Y GASFITERIA": "sanitarias",
  "AISLACION E IMPERMEABILIZACION": "obra_gruesa",
  "CLIMATIZACION Y AISLACION TERMICA": "terminaciones",
  PAISAJISMO: "adicionales",
};

export interface CubicacionItem {
  chapter: string; // normalized lowercase key (e.g. "demoliciones")
  chapterRaw: string; // original Excel label
  subChapter: string | null;
  itemNumber: string;
  name: string;
  description: string | null;
  unit: string;
  quantity: number;
}

export interface ParsedCubicacion {
  items: CubicacionItem[];
  warnings: string[];
}

function normalizeChapter(raw: string): string {
  if (!raw) return "adicionales";
  const upper = raw.trim().toUpperCase();
  return CHAPTER_MAPPING[upper] ?? raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/\./g, "").replace(/,/g, ".").trim();
    const n = parseFloat(s);
    if (!isNaN(n)) return n;
  }
  return 0;
}

/**
 * Detecta si una fila es de chapter: ITEM contiene solo dígitos
 * (típicamente "1", "2", "3"...), y la columna PARTIDA tiene el nombre.
 */
function isChapterRow(item: string, partida: string): boolean {
  return /^\d+$/.test(item) && partida.length > 0;
}

/**
 * Detecta si una fila es de sub-chapter: ITEM vacío, PARTIDA tiene un
 * texto en mayúsculas, DESCRIPCION vacía, sin cantidad. Heurística:
 * el texto suele ser un ambiente ("COCINA", "BAÑO PRINCIPAL").
 */
function isSubChapterRow(
  item: string,
  partida: string,
  description: string,
  qty: string
): boolean {
  return (
    item === "" &&
    partida.length > 0 &&
    description === "" &&
    qty === ""
  );
}

/**
 * Detecta si una fila es de ítem real: ITEM con formato "X.Y" y un nombre
 * + cantidad numérica.
 */
function isItemRow(
  item: string,
  partida: string,
  qty: string
): boolean {
  return /^\d+\.\d+$/.test(item) && partida.length > 0 && qty !== "";
}

/**
 * Parsea el buffer de un Excel de cubicación y devuelve la lista de
 * ítems con su chapter / subChapter resueltos.
 */
export function parseCubicacion(buffer: Buffer): ParsedCubicacion {
  const wb = XLSX.read(buffer, { cellDates: true });

  const sheetName = wb.SheetNames.find(
    (n) => n.trim().toUpperCase() === "CUBICACION"
  );
  if (!sheetName) {
    throw new Error(
      `No se encontró la hoja "CUBICACION" en el archivo. Hojas disponibles: ${wb.SheetNames.join(", ")}`
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  // Detectar columnas: buscamos la fila con "ITEM" "PARTIDA" "DESCRIPCION"
  // "UNIDAD" "CANTIDAD" y memoizamos los índices. El Excel de JP los pone
  // alrededor de la columna 2 (offset 2 dejando 2 columnas vacías).
  let cIdx = -1;
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const flat = rows[r].map(clean).map((s) => s.toUpperCase());
    const idx = flat.findIndex((s) => s === "ITEM");
    if (idx >= 0 && flat[idx + 1] === "PARTIDA") {
      cIdx = idx;
      headerRow = r;
      break;
    }
  }

  if (cIdx < 0) {
    throw new Error(
      "No se encontró la fila de encabezado (ITEM | PARTIDA | DESCRIPCION | UNIDAD | CANTIDAD) en la hoja CUBICACION."
    );
  }

  const COL_ITEM = cIdx;
  const COL_PARTIDA = cIdx + 1;
  const COL_DESC = cIdx + 3; // PARTIDA / (col vacía) / DESCRIPCION en el Excel de JP
  const COL_UNIT = cIdx + 4;
  const COL_QTY = cIdx + 5;

  const items: CubicacionItem[] = [];
  const warnings: string[] = [];

  let currentChapter = "adicionales";
  let currentChapterRaw = "";
  let currentSubChapter: string | null = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const item = clean(row[COL_ITEM]);
    const partida = clean(row[COL_PARTIDA]);
    // En el Excel hay una columna intermedia vacía (col cIdx+2) — la saltamos.
    const desc = clean(row[COL_DESC]);
    const unit = clean(row[COL_UNIT]);
    const qtyRaw = clean(row[COL_QTY]);

    // Saltar filas completamente vacías
    if (!item && !partida && !desc && !qtyRaw) continue;

    if (isChapterRow(item, partida)) {
      currentChapter = normalizeChapter(partida);
      currentChapterRaw = partida;
      currentSubChapter = null;
      continue;
    }

    if (isSubChapterRow(item, partida, desc, qtyRaw)) {
      currentSubChapter = partida;
      continue;
    }

    if (isItemRow(item, partida, qtyRaw)) {
      const quantity = num(row[COL_QTY]);
      items.push({
        chapter: currentChapter,
        chapterRaw: currentChapterRaw,
        subChapter: currentSubChapter,
        itemNumber: item,
        name: partida,
        description: desc || null,
        unit: unit || "UN",
        quantity,
      });
      continue;
    }

    // Si no calza con ningún patrón pero tiene algo de texto, lo ignoramos
    // silencioso para evitar ruido (el Excel a veces tiene basura abajo).
  }

  if (items.length === 0) {
    warnings.push("No se extrajo ningún ítem del Excel. Revisar formato.");
  }

  return { items, warnings };
}
