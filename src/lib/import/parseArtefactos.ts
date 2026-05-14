/**
 * Parser de Excel "artefactos" entregado por proveedores (MK, TEKA, LedStudio).
 *
 * El Excel viene con varias hojas, cada una arma una categoría:
 *   - "ARTEFACTOS SANITARIOS" → subcategory=sanitario, items agrupados por
 *     header de habitación ("BAÑO PRINCIPAL 1", "BAÑO SECUNDARIO 1", "BAÑO 3
 *     (VISITAS)", "BAÑO 4 (SERVICIO)") que se mapea a room.
 *   - "ARTEFACTOS TEKA COCINA" / cualquier sheet que contenga "COCINA" →
 *     subcategory=cocina, todos los items con room="cocina".
 *   - "ARTEFACTOS ILUMINACION LEDSTUDI" / sheets con "ILUMINACION" o "LED" →
 *     subcategory=iluminacion, room="otro" (el Excel no separa por habitación
 *     porque la iluminación atraviesa varios espacios).
 *
 * Las hojas viejas o de metadata (MAESTRA, sheets con "HG" — primera versión
 * desactualizada) se ignoran.
 *
 * Estructura típica de columnas dentro de cada hoja útil (offset variable):
 *   col B (opcional)  : nota lateral
 *   col C  ITEM       : nombre del artefacto (WC, GRIFERIA, etc)
 *   col D  DETALLE    : descripción del modelo
 *   col E  MARCA
 *   col F  CANTIDAD
 *   col G  PRECIO LISTA
 *   col H  DCTO       : % descuento (decimal, 0.36 = 36%)
 *   col I  TOTAL      : precio cliente con descuento aplicado
 *   col L  NETO MK    : costo real BLARQ
 *   col P  link MK    : URL de referencia
 */

import * as XLSX from "xlsx";

export interface ArtefactoParsedItem {
  room: string; // bano_principal | bano_secundario | bano_visita | cocina | otro
  subcategory: string; // sanitario | cocina | iluminacion
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null; // decimal 0..1
  clientPrice: number;
  realCostBlarq: number | null;
  referenceLink: string | null;
}

export interface ParsedArtefactos {
  items: ArtefactoParsedItem[];
  warnings: string[];
}

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/\./g, "").replace(/,/g, ".").trim();
    const n = parseFloat(s);
    if (!isNaN(n)) return n;
  }
  return null;
}

// Mapea el header "BAÑO PRINCIPAL 1" / "BAÑO 3 (VISITAS)" a la key
// canónica que usa la BD.
function mapRoomFromHeader(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (/PRINCIPAL/.test(u)) return "bano_principal";
  if (/SECUNDARIO/.test(u)) return "bano_secundario";
  if (/VISITA/.test(u)) return "bano_visita";
  if (/SERVICIO|EMPLEAD/.test(u)) return "otro";
  if (/COCINA/.test(u)) return "cocina";
  if (/LAVADERO/.test(u)) return "lavadero";
  // "BAÑO 1", "BAÑO 2" sin pistas → principal y secundario por orden
  if (/^BAÑO\s*1/.test(u)) return "bano_principal";
  if (/^BAÑO\s*2/.test(u)) return "bano_secundario";
  if (/^BAÑO\s*3/.test(u)) return "bano_visita";
  if (/^BAÑO\s*4/.test(u)) return "otro";
  return "otro";
}

// Decide si una hoja del Excel hay que parsearla y con qué subcategory.
// Retorna null si hay que saltarla.
function classifySheet(name: string): {
  subcategory: string;
  fallbackRoom: string;
} | null {
  const u = name.trim().toUpperCase();
  if (u === "MAESTRA") return null;
  // "ARTEFACTOS SANITARIOS HG" es la primera versión (V1) — la nueva versión
  // es "ARTEFACTOS SANITARIOS" sin sufijo. Si el sheet termina con sufijo
  // tipo "HG", lo saltamos.
  if (/ARTEFACTOS\s+SANITARIOS\s+HG\b/.test(u)) return null;
  if (/ILUMINACION|LED|LUMINARIA/.test(u)) {
    return { subcategory: "iluminacion", fallbackRoom: "otro" };
  }
  if (/COCINA|TEKA/.test(u)) {
    return { subcategory: "cocina", fallbackRoom: "cocina" };
  }
  if (/SANITARIO|BAÑ|BANO/.test(u)) {
    return { subcategory: "sanitario", fallbackRoom: "bano_principal" };
  }
  return null;
}

// Detectar la fila de header de tabla (ITEM | DETALLE | MARCA | CANTIDAD ...)
// y devolver índices de columnas.
function findHeader(
  rows: unknown[][]
): {
  rowIdx: number;
  col: {
    name: number;
    detail: number;
    brand: number;
    qty: number;
    listPrice: number;
    discount: number;
    clientPrice: number;
    realCost: number;
    link: number;
  };
} | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const flat = rows[r].map(clean).map((s) => s.toUpperCase());
    const itemIdx = flat.findIndex((s) => s === "ITEM");
    if (itemIdx < 0) continue;
    // Confirmar que esta fila es de header de tabla — debe tener "DETALLE"
    // o "MODELO" en la siguiente, y "CANTIDAD" más adelante.
    const detailIdx = flat.findIndex(
      (s, i) => i > itemIdx && (s === "DETALLE" || s === "MODELO")
    );
    const qtyIdx = flat.findIndex((s, i) => i > itemIdx && s === "CANTIDAD");
    if (detailIdx < 0 || qtyIdx < 0) continue;
    const brandIdx = flat.findIndex(
      (s, i) => i > itemIdx && (s === "MARCA" || s === "PROVEEDOR")
    );
    const listIdx = flat.findIndex(
      (s, i) => i > itemIdx && /PRECIO\s*LISTA/.test(s)
    );
    const discountIdx = flat.findIndex(
      (s, i) => i > itemIdx && (s === "DCTO" || s === "DESCTO" || s === "DESCUENTO")
    );
    const clientIdx = flat.findIndex(
      (s, i) => i > itemIdx && (s === "TOTAL" || s === "TOTAL ")
    );
    // "NETO MK" o "NETO" o "PRECIO NETO BLARQ" — el costo real BLARQ.
    const realCostIdx = flat.findIndex(
      (s, i) => i > itemIdx && (/NETO\s*MK/.test(s) || /NETO\s*BLARQ/.test(s) || /PRECIO\s*NETO\s*BLARQ/.test(s))
    );
    // La columna de link suele estar al final, busco columnas con URLs en
    // las filas siguientes. Heurística: el primer índice > clientIdx donde
    // alguna fila tiene un texto que arranca con "http".
    let linkIdx = -1;
    for (let cc = (clientIdx > 0 ? clientIdx : itemIdx) + 1; cc < rows[r].length + 5; cc++) {
      for (let rr = r + 1; rr < Math.min(rows.length, r + 20); rr++) {
        const cell = clean(rows[rr]?.[cc]);
        if (/^https?:\/\//.test(cell)) {
          linkIdx = cc;
          break;
        }
      }
      if (linkIdx >= 0) break;
    }

    return {
      rowIdx: r,
      col: {
        name: itemIdx,
        detail: detailIdx,
        brand: brandIdx >= 0 ? brandIdx : itemIdx + 2,
        qty: qtyIdx,
        listPrice: listIdx >= 0 ? listIdx : qtyIdx + 1,
        discount: discountIdx >= 0 ? discountIdx : qtyIdx + 2,
        clientPrice: clientIdx >= 0 ? clientIdx : qtyIdx + 3,
        realCost: realCostIdx,
        link: linkIdx,
      },
    };
  }
  return null;
}

// Detecta si una fila es separador de habitación (encabezado tipo
// "BAÑO PRINCIPAL 1" puesto solo en una de las columnas de la izquierda).
function detectRoomHeader(
  row: unknown[],
  itemCol: number
): string | null {
  // Buscamos la primera celda con texto en mayúsculas tipo "BAÑO X" o
  // "COCINA" o "LAVADERO" — antes o en la columna ITEM.
  for (let c = 0; c <= itemCol + 1 && c < row.length; c++) {
    const v = clean(row[c]).toUpperCase();
    if (!v) continue;
    if (
      /BAÑO|BANO|COCINA|LAVADERO|TERRAZA|DORMITORIO|LIVING|PASILLO|HALL/.test(v)
    ) {
      // Filtrar headers de tabla que también pueden contener "COCINA" en
      // el name de la hoja.
      if (v === "ITEM" || v === "DETALLE" || v === "MODELO") return null;
      return v;
    }
  }
  return null;
}

function parseSheet(
  rows: unknown[][],
  subcategory: string,
  fallbackRoom: string,
  warnings: string[]
): ArtefactoParsedItem[] {
  const items: ArtefactoParsedItem[] = [];
  const header = findHeader(rows);
  if (!header) {
    warnings.push(
      `No se encontró fila de encabezado en una hoja (${subcategory}). Hoja saltada.`
    );
    return items;
  }

  let currentRoom = fallbackRoom;

  for (let r = header.rowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    // ¿Es header de habitación?
    const roomHeader = detectRoomHeader(row, header.col.name);
    if (roomHeader && clean(row[header.col.qty]) === "") {
      // Confirmar que no hay item en esta fila (cantidad vacía).
      currentRoom = mapRoomFromHeader(roomHeader);
      continue;
    }

    const name = clean(row[header.col.name]);
    const qty = num(row[header.col.qty]);

    // Filas vacías o de totales no son items.
    if (!name) continue;
    const nameUpper = name.toUpperCase();
    if (
      /^TOTAL/.test(nameUpper) ||
      nameUpper === "ITEM" ||
      nameUpper === "DETALLE" ||
      nameUpper === "MODELO"
    ) {
      continue;
    }

    if (qty === null || qty <= 0) {
      // Sin cantidad real — saltamos (puede ser fila de subtotal sin name
      // estándar).
      continue;
    }

    const detail = clean(row[header.col.detail]);
    const brand = clean(row[header.col.brand]);
    const listPrice = num(row[header.col.listPrice]);
    const discount = num(row[header.col.discount]);
    const clientPrice = num(row[header.col.clientPrice]);
    const realCost =
      header.col.realCost >= 0 ? num(row[header.col.realCost]) : null;
    const link =
      header.col.link >= 0 ? clean(row[header.col.link]) : "";
    const linkValid = /^https?:\/\//.test(link) ? link : null;

    // El "clientPrice" del Excel es total (cantidad x unitario con descuento).
    // En BD guardamos clientPrice unitario para mantener consistencia con
    // el resto del flujo de artefactos. Si la columna trae el TOTAL (qty x
    // unitario), dividimos por qty. Si no hay clientPrice pero sí listPrice
    // y descuento, calculamos.
    let clientUnit = 0;
    if (clientPrice !== null && qty > 0) {
      clientUnit = clientPrice / qty;
    } else if (listPrice !== null) {
      const d = discount ?? 0;
      clientUnit = listPrice * (1 - d);
    }

    // realCostBlarq también suele venir como TOTAL (qty x unitario). Lo
    // pasamos a unitario por la misma razón. Si no hay, queda null.
    let realCostUnit: number | null = null;
    if (realCost !== null && qty > 0) {
      realCostUnit = realCost / qty;
    }

    items.push({
      room: currentRoom,
      subcategory,
      name,
      detail: detail || null,
      brand: brand || null,
      quantity: Math.round(qty),
      listPrice: listPrice ?? 0,
      discountPercent: discount,
      clientPrice: Math.round(clientUnit),
      realCostBlarq: realCostUnit !== null ? Math.round(realCostUnit) : null,
      referenceLink: linkValid,
    });
  }

  return items;
}

/**
 * Parsea el buffer de un Excel de artefactos y devuelve la lista de
 * items con su room/subcategory resueltos.
 */
export function parseArtefactos(buffer: Buffer): ParsedArtefactos {
  const wb = XLSX.read(buffer, { cellDates: true });
  const items: ArtefactoParsedItem[] = [];
  const warnings: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const cls = classifySheet(sheetName);
    if (!cls) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
    const parsed = parseSheet(
      rows,
      cls.subcategory,
      cls.fallbackRoom,
      warnings
    );
    items.push(...parsed);
  }

  if (items.length === 0) {
    warnings.push(
      "No se extrajo ningún ítem del Excel. Revisar formato (hojas reconocidas: ARTEFACTOS SANITARIOS, ARTEFACTOS COCINA / TEKA, ARTEFACTOS ILUMINACION)."
    );
  }

  return { items, warnings };
}
