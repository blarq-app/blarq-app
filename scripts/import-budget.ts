// Import legacy de presupuestos Excel (V3/V4) hacia la app.
//
// Uso:
//   npx tsx scripts/import-budget.ts \
//     --project="Cocina Farellones" \
//     --version=V4 \
//     --obra="<ruta>.xlsx" \
//     --muebles="<ruta>.xls" \
//     --artefactos="<ruta>.xlsx" \
//     [--dry-run | --commit]
//
// Por default es dry-run: imprime el reporte sin escribir nada en BD.
// Con --commit ejecuta los inserts dentro de una transacción.
//
// Reglas que respeta (ver docs/principles.md):
//   - PartidaCatalog NO se duplica. Si (category, name) ya existe, se
//     reusa el ID, NO se actualizan precios ni componentes.
//   - Si los precios del proyecto difieren del catálogo, los precios
//     viven en `ObraItem` (denormalizados) con `isCustomized = true`.
//
// Salida del reporte:
//   - Por cada tipo (obra, muebles, artefactos): cuántos items, total
//     cliente, total con IVA cuando aplica.
//   - Para obra: cuántas partidas se reusaron del catálogo, cuántas
//     se agregaron como nuevas, cuántas quedaron `isCustomized`.
//   - Verificación: totales del Excel vs totales calculados.

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

// Mapping de chapters del Excel (UPPERCASE/variantes) a las 8 keys
// oficiales en lib/utils.ts > OBRA_CHAPTERS. Históricamente se cargaba
// el chapter "tal cual" del Excel (DEMOLICIONES, INSTALACIONES SANITARIAS,
// etc) pero el editor del front filtra por las keys lowercase y los
// items quedaban "invisibles". Mismo mapping que scripts/normalize-obra-chapters.ts.
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

function normalizeChapter(raw: string | undefined | null): string {
  if (!raw) return "adicionales";
  const upper = raw.trim().toUpperCase();
  return CHAPTER_MAPPING[upper] ?? raw.trim().toLowerCase().replace(/\s+/g, "_");
}
import "dotenv/config";

const prisma = new PrismaClient();

// ─── Args parsing ────────────────────────────────────────────────────────

interface CliArgs {
  project: string;
  version: string;
  obra?: string;
  muebles?: string;
  artefactos?: string;
  /** Lista de nombres de hojas (case-insensitive) a ignorar en artefactos.
   *  Útil cuando el archivo tiene alternativas no elegidas (ej. HANSGROHE
   *  cuando se eligió URBAN). Caso real: Aguirre V7. */
  ignoreSheets: string[];
  /** Status del BudgetVersion creado. Default "aprobado". Útil para
   *  cargar anexos/alternativas como "borrador" para que no entren al
   *  bestVersion de metrics.ts. */
  status: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.slice(`--${name}=`.length) : undefined;
  };
  const project = get("project");
  const version = get("version");
  if (!project || !version) {
    console.error(
      "Faltan args obligatorios: --project=<id|name> --version=<V4>"
    );
    process.exit(1);
  }
  const ignoreSheetsRaw = get("ignore-sheets") ?? "";
  const ignoreSheets = ignoreSheetsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    project,
    version,
    obra: get("obra"),
    muebles: get("muebles"),
    artefactos: get("artefactos"),
    ignoreSheets,
    status: get("status") ?? "aprobado",
    dryRun: !args.includes("--commit"),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Limpia espacios múltiples y trim — los Excel suelen tener "  CIERRE  OSB ". */
function clean(s: unknown): string {
  if (s == null) return "";
  return String(s).trim().replace(/\s+/g, " ");
}

/** Convierte a número seguro. "" / null / undefined → 0. */
function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$.,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Format CLP para el reporte. */
function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

// ─── Tipos parseados ─────────────────────────────────────────────────────

interface ParsedComponent {
  type: string; // material | mano_obra | margen | herramientas | subcontrato | perdida
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceLink?: string;
}

interface ParsedCatalogPartida {
  category: string;
  name: string;
  unit: string;
  components: ParsedComponent[];
  // Suma agregada (para `costMaterial`, `costLabor`, etc del ObraItem)
  costMaterial: number;
  costLabor: number;
  costMargin: number;
  costTools: number;
  costLoss: number;
  costSubcontract: number;
  unitPrice: number; // suma total (lo que cobra al cliente por unidad)
}

interface ParsedObraItem {
  itemNumber: string; // "1.1"
  chapter: string; // "DEMOLICION"
  partidaName: string; // "RETIRO MOBILIARIO COCINA"
  descriptionCliente?: string;
  unit: string;
  quantity: number;
  unitPrice: number; // P.U al cliente, del Excel
  total: number; // cantidad × unitPrice
  laborUnitPrice: number; // P.U mano de obra (lo que paga al maestro)
  laborTotal: number; // total MO

  // Desglose de costos (denormalizado en ObraItem). Se completa después
  // del parsing cruzando con BASE DATOS. Para items SIN match en BASE
  // DATOS (adicionales tipeados directo en PRESUPUESTO), regla MJ
  // 2026-05-05: la columna MO del Excel = costLabor; el resto = costMaterial.
  costMaterial?: number;
  costLabor?: number;
  costMargin?: number;
  costTools?: number;
  costLoss?: number;
  costSubcontract?: number;
  // Indica si los costos vienen del catálogo (false) o se infirieron del
  // Excel sin desglose (true).
  costFromExcelOnly?: boolean;
}

interface ParsedObra {
  catalog: ParsedCatalogPartida[];
  items: ParsedObraItem[];
  /** Items adicionales tipeados después del "TOTAL MANO DE OBRA" del Excel.
   *  No entran en el costo directo oficial del V4; son extras post-cierre. */
  extras: ParsedObraItem[];
  /** Porcentajes leídos del Excel (filas COSTO DIRECTO / GG / UTILIDAD).
   *  Si el Excel los declara, se usan esos. Si no, defaults BLARQ
   *  (GG 23%, Util 5%) que aplican al template Pauline Dumay V4. */
  percentages: {
    gg: number; // porcentaje 0-100
    utility: number; // porcentaje 0-100
  };
  totals: {
    materiales: number;
    manoObra: number;
    margen: number;
    herramientas: number;
    perdidas: number;
    subcontrato: number;
    sumaTotales: number;
    presupuestoTotal: number; // suma de items[].total (oficial)
    extrasTotal: number; // suma de extras[].total
  };
}

// ─── Tipos parseados — MUEBLES ──────────────────────────────────────────

interface ParsedMuebleDetail {
  name: string;
  material: string;
}

interface ParsedMuebleItem {
  itemNumber: string; // "1.1"
  name: string; // "MUEBLES", "HERRAJES"
  descriptionGeneral?: string;
  quantity: number;
  supplier?: string;
  costDistributor: number;
  utilityPercentage: number; // decimal
  clientPriceNet: number;
  clientPriceIva: number;
  details: ParsedMuebleDetail[];
}

interface ParsedMuebleChapter {
  chapterNumber: number;
  name: string; // "MUEBLES DE COCINA"
  items: ParsedMuebleItem[];
}

interface ParsedMuebles {
  chapters: ParsedMuebleChapter[];
  totals: {
    sumItems: number;
    discountPercent: number; // 0.02 = 2% off, si aplica
    afterDiscount: number;
  };
  observations: string[];
  paymentTerms: { stage: string; percentage: number }[];
}

// ─── Tipos parseados — ARTEFACTOS ───────────────────────────────────────

interface ParsedArtefactoItem {
  room: string; // "bano_principal", "cocina", "logia"
  subcategory: string; // "sanitario" | "cocina"
  name: string;
  detail?: string;
  brand?: string;
  quantity: number;
  listPrice: number;
  discountPercent: number; // decimal
  clientPrice: number;
  realCostBlarq?: number;
}

interface ParsedArtefactos {
  items: ParsedArtefactoItem[];
  total: number;
  ignoredSheets: string[]; // hojas V3/V1 que no se importaron
}

// ─── Tipo de concepto: normaliza el string del Excel ─────────────────────

function normalizeConceptType(raw: string): string | null {
  const t = clean(raw).toUpperCase();
  if (t.startsWith("MATERIAL")) return "material";
  if (t.startsWith("MANO")) return "mano_obra";
  if (t.startsWith("MARGEN")) return "margen";
  if (t.startsWith("HERRAMIENT")) return "herramientas";
  if (t.startsWith("SUBCONTRAT")) return "subcontrato";
  if (t.startsWith("PERDIDA") || t.startsWith("PÉRDIDA")) return "perdida";
  return null;
}

// ─── Parser de OBRA ──────────────────────────────────────────────────────
// Lee dos hojas:
//  - "BASE DATOS": catálogo de partidas con sus componentes
//  - "PRESUPUESTO": instancia del proyecto (cantidades + P.U cliente)

function parseObra(filePath: string): ParsedObra {
  const wb = XLSX.readFile(filePath, { cellDates: true });

  // ── BASE DATOS ──
  if (!wb.SheetNames.includes("BASE DATOS")) {
    throw new Error(`Hoja "BASE DATOS" no existe en ${filePath}`);
  }
  const bd = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets["BASE DATOS"],
    { header: 1, defval: "", raw: true }
  ) as unknown as unknown[][];

  // Esperamos cabecera en r0:
  // [NOMBRE CATEGORIA, NOMBRE PARTIDA, UNIDAD PARTIDA, NOMBRE SUB PARTIDA,
  //  CONCEPTO, DETALLE CONCEPTO, DESCRIPCION, UNIDAD DEL CONCEPTO, CANTIDAD,
  //  P. CONCEPTO NETO, P.U NETO, P.U (UF), LINK, VALOR ACTUALIZADO]

  // Agrupamos componentes por (category, name).
  const partidasMap = new Map<string, ParsedCatalogPartida>();
  const keyOf = (cat: string, name: string) => `${cat}||${name}`;

  for (let r = 1; r < bd.length; r++) {
    const row = bd[r];
    const category = clean(row[0]);
    const name = clean(row[1]);
    const unit = clean(row[2]);
    const conceptRaw = clean(row[4]);
    const detail = clean(row[5]);
    const conceptUnit = clean(row[7]);
    const quantity = num(row[8]);
    const unitCost = num(row[9]);
    const totalCost = num(row[10]);
    const link = clean(row[12]) || undefined;

    if (!category || !name || !conceptRaw) continue;
    const type = normalizeConceptType(conceptRaw);
    if (!type) continue;

    const k = keyOf(category, name);
    if (!partidasMap.has(k)) {
      partidasMap.set(k, {
        category,
        name,
        unit,
        components: [],
        costMaterial: 0,
        costLabor: 0,
        costMargin: 0,
        costTools: 0,
        costLoss: 0,
        costSubcontract: 0,
        unitPrice: 0,
      });
    }
    const p = partidasMap.get(k)!;
    p.components.push({
      type,
      description: detail,
      unit: conceptUnit,
      quantity,
      unitCost,
      totalCost,
      referenceLink: link,
    });
    if (type === "material") p.costMaterial += totalCost;
    else if (type === "mano_obra") p.costLabor += totalCost;
    else if (type === "margen") p.costMargin += totalCost;
    else if (type === "herramientas") p.costTools += totalCost;
    else if (type === "subcontrato") p.costSubcontract += totalCost;
    else if (type === "perdida") p.costLoss += totalCost;
  }

  // Calcular unitPrice agregado por partida = suma de todos los totalCost
  for (const p of partidasMap.values()) {
    p.unitPrice =
      p.costMaterial +
      p.costLabor +
      p.costMargin +
      p.costTools +
      p.costLoss +
      p.costSubcontract;
  }

  const catalog = Array.from(partidasMap.values());

  // ── PRESUPUESTO ──
  if (!wb.SheetNames.includes("PRESUPUESTO")) {
    throw new Error(`Hoja "PRESUPUESTO" no existe en ${filePath}`);
  }
  const pr = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["PRESUPUESTO"], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  // Cabecera de tabla está cerca de la fila ~19 (índice 18). Buscamos la
  // fila que tenga "ITEM" + "PARTIDA" + "CANTIDAD" para no hardcodear.
  let headerRow = -1;
  for (let r = 0; r < Math.min(pr.length, 30); r++) {
    const row = pr[r] as unknown[];
    const flat = row.map((v) => clean(v).toUpperCase()).join("|");
    if (flat.includes("ITEM") && flat.includes("PARTIDA") && flat.includes("CANTIDAD")) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error(`No se encontró cabecera en hoja PRESUPUESTO`);
  }

  // Las columnas del PRESUPUESTO según lo observado:
  // C (idx 2) ITEM, D (idx 3) PARTIDA, F (idx 5) DESCRIPCION,
  // G (idx 6) UNIDAD, H (idx 7) CANTIDAD, I (idx 8) P.U cliente, J (idx 9) TOTAL,
  // N (idx 13) P.U MO, O (idx 14) TOTAL MO

  // Detección del fin del presupuesto oficial:
  //   La hoja PRESUPUESTO incluye después de los items una línea
  //   "TOTAL MANO DE OBRA" y luego ESTADOS DE PAGO. Items que aparecen
  //   DESPUÉS de esa línea son adicionales tipeados post-cierre del V4
  //   (extras de obra) y NO se cuentan en el costo directo del V4 oficial.
  //   Se reportan aparte como `extras`.
  let cutoffRow = pr.length;
  for (let r = headerRow + 1; r < pr.length; r++) {
    const row = pr[r];
    const flat = row.map((v) => clean(v).toUpperCase()).join("|");
    if (flat.includes("TOTAL MANO DE OBRA") || flat.includes("ESTADO DE PAGO")) {
      cutoffRow = r;
      break;
    }
  }

  // Dedup por (itemNumber + nombre normalizado): si dos filas comparten
  // itemNumber pero tienen NOMBRES distintos, son items distintos que
  // compartieron numeración por error humano. Se mantienen ambos
  // (advertencia en reporte). Caso real: en V4 Pauline Dumay,
  // "3.4 INSTALACION LUMINARIA" y "3.4 PROVISIÓN LUMINARIA" son items
  // distintos de luminaria.
  const itemsByKey = new Map<string, ParsedObraItem>();
  const extras: ParsedObraItem[] = []; // items post-cutoff
  const numberCollisions = new Map<string, Set<string>>(); // itemNumber → set de nombres
  let currentChapter = "";
  for (let r = headerRow + 1; r < pr.length; r++) {
    const row = pr[r];
    const itemNumber = clean(row[2]);
    const partidaName = clean(row[3]);
    const description = clean(row[5]);
    const unit = clean(row[6]);
    const quantity = num(row[7]);
    const unitPrice = num(row[8]);
    const total = num(row[9]);
    const laborUnit = num(row[13]);
    const laborTotal = num(row[14]);

    if (!itemNumber && !partidaName) continue;

    // Capítulo: itemNumber es entero ("1", "2"...) y no tiene subitem
    const isChapter = /^\d+$/.test(itemNumber);
    if (isChapter) {
      currentChapter = partidaName.toUpperCase();
      continue;
    }

    // Item normal: itemNumber tipo "1.1"
    const isItem = /^\d+\.\d+/.test(itemNumber);
    if (!isItem) continue;
    if (!partidaName) continue;

    const nameKey = partidaName.toUpperCase().trim();
    const key = `${itemNumber}||${nameKey}`;
    const isPostCutoff = r >= cutoffRow;

    // Track colisión solo en items pre-cutoff (los oficiales)
    if (!isPostCutoff) {
      if (!numberCollisions.has(itemNumber)) {
        numberCollisions.set(itemNumber, new Set());
      }
      numberCollisions.get(itemNumber)!.add(nameKey);
    }

    const itemRecord: ParsedObraItem = {
      itemNumber,
      chapter: currentChapter,
      partidaName,
      descriptionCliente: description || undefined,
      unit,
      quantity,
      unitPrice,
      total,
      laborUnitPrice: laborUnit,
      laborTotal,
    };

    if (isPostCutoff) {
      // Item adicional post-cierre del presupuesto oficial.
      extras.push(itemRecord);
    } else {
      // Si ya existe (mismo número + mismo nombre), preservar chapter de
      // la primera aparición y sobrescribir el resto con la última edición.
      const existing = itemsByKey.get(key);
      itemsByKey.set(key, {
        ...itemRecord,
        chapter: existing?.chapter || currentChapter,
      });
    }
  }
  const items: ParsedObraItem[] = Array.from(itemsByKey.values());

  // Detecta colisiones de número (mismo itemNumber con > 1 nombre)
  const collisions: { itemNumber: string; names: string[] }[] = [];
  for (const [num, names] of numberCollisions.entries()) {
    if (names.size > 1) {
      collisions.push({ itemNumber: num, names: Array.from(names) });
    }
  }
  if (collisions.length > 0) {
    (items as unknown as { __collisions?: typeof collisions }).constructor; // noop
    // Adjunta como propiedad oculta para el reporter
    Object.defineProperty(items, "__collisions", {
      value: collisions,
      enumerable: false,
    });
  }

  // ── Totales por concepto (de la hoja MAESTRA si existe) ──
  let totalsFromMaestra = {
    materiales: 0,
    manoObra: 0,
    margen: 0,
    herramientas: 0,
    perdidas: 0,
    subcontrato: 0,
    sumaTotales: 0,
  };
  if (wb.SheetNames.includes("MAESTRA")) {
    const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["MAESTRA"], {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
    for (const row of m) {
      const label = clean(row[0]).toUpperCase();
      const val = num(row[2]);
      if (label === "MATERIALES") totalsFromMaestra.materiales = val;
      else if (label === "MANO OBRA") totalsFromMaestra.manoObra = val;
      else if (label === "MARGEN") totalsFromMaestra.margen = val;
      else if (label === "HERRAMIENTAS") totalsFromMaestra.herramientas = val;
      else if (label.startsWith("PERDIDA") || label.startsWith("PÉRDIDA"))
        totalsFromMaestra.perdidas = val;
      else if (label === "SUBCONTRATO") totalsFromMaestra.subcontrato = val;
      else if (label.includes("SUMA TOTALES")) totalsFromMaestra.sumaTotales = val;
    }
  }

  // ── Completar desglose de costos por item ──
  // Para cada item del PRESUPUESTO, cruzar con el catálogo extraído de
  // BASE DATOS y obtener costMaterial / costLabor / etc proporcionales
  // a la cantidad. Para items sin match en BASE DATOS, aplicar la regla
  // de MJ: total MO del Excel → costLabor; resto del total → costMaterial.
  const catalogByName = new Map<string, ParsedCatalogPartida>();
  for (const p of catalog) {
    catalogByName.set(p.name.toUpperCase().trim(), p);
  }
  // CONVENCIÓN DE LA APP: ObraItem.cost* se guarda POR UNIDAD (igual que
  // PartidaCatalog). metrics.ts multiplica por quantity para obtener el
  // monto total agregado. Si guardamos totales acá rompemos esa convención
  // y metrics.ts saca el doble del costo real.
  const fillCosts = (it: ParsedObraItem) => {
    // Item con qty 0 y total 0: no se usa en el proyecto. Costos en 0.
    // (Caso real Pauline Dumay: "6.6 PUERTA NUEVA PERFIL METALICO NEGRO"
    // está en el PRESUPUESTO como referencia con qty=0 y total=0).
    if (it.quantity === 0 && it.total === 0 && it.laborTotal === 0) {
      it.costMaterial = 0;
      it.costLabor = 0;
      it.costMargin = 0;
      it.costTools = 0;
      it.costLoss = 0;
      it.costSubcontract = 0;
      it.costFromExcelOnly = true;
      return;
    }

    const key = it.partidaName.toUpperCase().trim();
    const cat = catalogByName.get(key);

    // Si hay match con catálogo Y el ítem se usa (qty>0, total>0):
    // las proporciones del catálogo (que son POR UNIDAD) se escalan al
    // unitPrice real del proyecto. La suma de cost* (por unidad) ==
    // unitPrice del proyecto, garantizando que sum(cost*×qty) == total.
    if (cat && cat.unitPrice > 0 && it.quantity > 0 && it.total > 0) {
      const scale = it.unitPrice / cat.unitPrice;
      it.costMaterial = cat.costMaterial * scale;
      it.costLabor = cat.costLabor * scale;
      it.costMargin = cat.costMargin * scale;
      it.costTools = cat.costTools * scale;
      it.costLoss = cat.costLoss * scale;
      it.costSubcontract = cat.costSubcontract * scale;
      it.costFromExcelOnly = Math.abs(scale - 1) > 0.02;
      return;
    }

    // Sin match en catálogo, o item sin uso real con MO>0 (regla MJ):
    // la columna MO del Excel es costLabor; el resto es costMaterial.
    // Convertir a POR UNIDAD dividiendo por quantity.
    const qty = it.quantity > 0 ? it.quantity : 1;
    it.costLabor = it.laborTotal / qty;
    it.costMaterial = Math.max(0, (it.total - it.laborTotal) / qty);
    it.costMargin = 0;
    it.costTools = 0;
    it.costLoss = 0;
    it.costSubcontract = 0;
    it.costFromExcelOnly = true;
  };

  // Post-process: garantizar que para CADA item la suma de componentes
  // sea exactamente igual a it.total. Esto cubre cualquier residuo de
  // redondeo o caso raro (item con MO en Excel pero total $0 al cliente,
  // ej "14.9 GRANO EXTERIOR" — no entra en el costo directo del cliente
  // aunque haya MO declarada en otra columna).
  // Reconcilia: la suma de cost* (POR UNIDAD) debe igualar unitPrice del
  // Excel. Si el item no se usa (total=0), todo a 0.
  const reconcileItemCosts = (it: ParsedObraItem) => {
    if (it.total === 0) {
      it.costMaterial = 0;
      it.costLabor = 0;
      it.costMargin = 0;
      it.costTools = 0;
      it.costLoss = 0;
      it.costSubcontract = 0;
      return;
    }
    const sumPerUnit =
      (it.costMaterial ?? 0) +
      (it.costLabor ?? 0) +
      (it.costMargin ?? 0) +
      (it.costTools ?? 0) +
      (it.costLoss ?? 0) +
      (it.costSubcontract ?? 0);
    if (sumPerUnit > 0 && Math.abs(sumPerUnit - it.unitPrice) > 0.01) {
      const k = it.unitPrice / sumPerUnit;
      it.costMaterial = (it.costMaterial ?? 0) * k;
      it.costLabor = (it.costLabor ?? 0) * k;
      it.costMargin = (it.costMargin ?? 0) * k;
      it.costTools = (it.costTools ?? 0) * k;
      it.costLoss = (it.costLoss ?? 0) * k;
      it.costSubcontract = (it.costSubcontract ?? 0) * k;
    }
  };
  items.forEach(fillCosts);
  items.forEach(reconcileItemCosts);
  extras.forEach(fillCosts);
  extras.forEach(reconcileItemCosts);

  const presupuestoTotal = items.reduce((s, i) => s + i.total, 0);
  const extrasTotal = extras.reduce((s, i) => s + i.total, 0);

  // Leer porcentajes GG y Utilidad del Excel. Buscar filas que tengan
  // "GASTOS GENERALES" o "UTILIDAD" en alguna celda y leer el % de la
  // columna E (col 4 índice 0) — formato: la celda dice 0.05, 0.23, etc.
  let ggPct = 23; // default Pauline V4
  let utilPct = 5;
  for (let r = 0; r < pr.length; r++) {
    const row = pr[r];
    const flat = row.map((v) => clean(v).toUpperCase()).join("|");
    if (flat.includes("GASTO") && flat.includes("GENERAL")) {
      const pct = num(row[4]);
      if (pct > 0 && pct < 1) ggPct = pct * 100;
      else if (pct >= 1 && pct < 100) ggPct = pct;
    }
    if (flat.includes("UTILIDAD")) {
      const pct = num(row[4]);
      if (pct > 0 && pct < 1) utilPct = pct * 100;
      else if (pct >= 1 && pct < 100) utilPct = pct;
    }
  }

  return {
    catalog,
    items,
    extras,
    percentages: { gg: ggPct, utility: utilPct },
    totals: {
      ...totalsFromMaestra,
      presupuestoTotal,
      extrasTotal,
    },
  };
}

// ─── Parser de MUEBLES ──────────────────────────────────────────────────
// Lee dos hojas del .xls/.xlsx:
//  - "MUEBLES" (datos de cálculo interno: proveedor, costo, utilidad)
//  - "PRESUPUESTO MUEBLES" (estructura de chapters/items que ve el cliente,
//    con descripciones, sub-detalles, formas de pago y descuento global)

function parseMuebles(filePath: string): ParsedMuebles {
  const wb = XLSX.readFile(filePath, { cellDates: true });

  // Hoja con datos de proveedor/precio/utilidad
  const muebSheetName = wb.SheetNames.find(
    (n) => n.toUpperCase().trim() === "MUEBLES"
  );
  // Hoja con la estructura del presupuesto
  const ppSheetName = wb.SheetNames.find(
    (n) => n.toUpperCase().includes("PRESUPUESTO")
  );
  if (!muebSheetName || !ppSheetName) {
    throw new Error(
      `No se encontraron hojas MUEBLES + PRESUPUESTO en ${filePath}`
    );
  }

  // ── Hoja MUEBLES (datos de cálculo) ──
  const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[muebSheetName], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  // La hoja MUEBLES puede tener UN bloque (caso simple — Pauline Dumay) o
  // VARIOS bloques (caso Aguirre: COCINA / BAÑO PRINCIPAL / BANQUETA). Cada
  // bloque tiene su propia cabecera "ITEM | PROVEEDOR | ...". Detectamos
  // todos los bloques recorriendo la hoja y agrupamos las filas de datos
  // bajo el chapter declarado justo antes de cada cabecera.
  type MueblesRowData = {
    name: string;
    supplier: string;
    material: string;
    costDistributor: number;
    utilityPercentage: number;
    clientPriceNet: number;
    clientPriceIva: number;
    blockChapter: string; // "COCINA", "BAÑO PRINCIPAL", "BANQUETA", o "" si bloque único
  };
  const dataRows: MueblesRowData[] = [];

  // Encontrar todas las filas que son cabeceras "ITEM | PROVEEDOR | ..."
  const headerRows: number[] = [];
  for (let r = 0; r < m.length; r++) {
    const flat = m[r].map((v) => clean(v).toUpperCase()).join("|");
    if (
      flat.includes("ITEM") &&
      flat.includes("PROVEEDOR") &&
      flat.includes("PRECIO DISTRIBUIDOR")
    ) {
      headerRows.push(r);
    }
  }
  if (headerRows.length === 0) {
    throw new Error(`No se encontró cabecera de cálculo en hoja MUEBLES`);
  }

  // Para cada bloque, leer filas hasta encontrar "TOTAL NETO" o el inicio
  // del próximo bloque.
  for (let bi = 0; bi < headerRows.length; bi++) {
    const headerRow = headerRows[bi];
    const nextHeaderRow =
      bi + 1 < headerRows.length ? headerRows[bi + 1] : m.length;

    // Detectar el chapter del bloque: buscar ARRIBA del header una fila
    // con UNA sola celda no vacía con texto (típicamente cabecera tipo
    // "COCINA", "BAÑO PRINCIPAL"). Si no se encuentra, blockChapter="".
    let blockChapter = "";
    for (let r = headerRow - 1; r >= Math.max(0, headerRow - 8); r--) {
      const row = m[r];
      const nonEmpty = row.filter((v) => clean(v) !== "");
      // Una sola celda con texto, no un total
      if (nonEmpty.length === 1) {
        const txt = clean(nonEmpty[0]).toUpperCase();
        if (
          !txt.startsWith("TOTAL") &&
          !txt.startsWith("IVA") &&
          !txt.startsWith("UTILIDAD") &&
          txt.length > 2
        ) {
          blockChapter = txt;
          break;
        }
      }
    }

    for (let r = headerRow + 1; r < nextHeaderRow; r++) {
      const row = m[r];
      const item = clean(row[1]);
      const supplier = clean(row[2]);
      const material = clean(row[3]);
      const costDistributor = num(row[4]);
      const utilityPct = num(row[5]);
      const clientPriceNet = num(row[6]);
      const clientPriceIva = num(row[7]);

      const itemUpper = item.toUpperCase();
      if (
        !item ||
        itemUpper === "TOTAL" ||
        itemUpper.startsWith("TOTAL ") ||
        itemUpper === "IVA" ||
        itemUpper.startsWith("UTILIDAD")
      ) {
        continue;
      }
      if (clientPriceIva === 0 && clientPriceNet === 0) continue;

      dataRows.push({
        name: itemUpper.trim(),
        supplier,
        material,
        costDistributor,
        utilityPercentage: utilityPct,
        clientPriceNet,
        clientPriceIva,
        blockChapter,
      });
    }
  }

  // ── Hoja PRESUPUESTO MUEBLES (estructura) ──
  const pp = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[ppSheetName], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  // Buscar cabecera "ITEM | PARTIDA | DESCRIPCION | CANTIDAD | TOTAL"
  let ppHeaderRow = -1;
  for (let r = 0; r < pp.length; r++) {
    const flat = pp[r].map((v) => clean(v).toUpperCase()).join("|");
    if (flat.includes("ITEM") && flat.includes("PARTIDA") && flat.includes("CANTIDAD")) {
      ppHeaderRow = r;
      break;
    }
  }
  if (ppHeaderRow === -1) {
    throw new Error(`No se encontró cabecera en hoja PRESUPUESTO MUEBLES`);
  }

  // Cols del PRESUPUESTO MUEBLES: B(1)? C(2)=ITEM, D(3)=PARTIDA, F(5)=DESC, H(7)=CANT, I(8)=TOTAL
  // (offset: igual a OBRA pero con descripcion en F y total en I)
  const chapters: ParsedMuebleChapter[] = [];
  let currentChapter: ParsedMuebleChapter | null = null;
  let currentItem: ParsedMuebleItem | null = null;
  let discountPercent = 0;
  const observations: string[] = [];
  const paymentTerms: { stage: string; percentage: number }[] = [];

  // Match flexible: si el PRESUPUESTO tiene capítulo, intentar match dentro
  // del bloque de la hoja MUEBLES con chapter compatible. Esto evita que
  // "1.1 MUEBLES" del cap "BANQUETA" matchee con el "MUEBLE COCINA" del
  // bloque "COCINA" cuando hay múltiples bloques.
  const stemOf = (s: string) =>
    s
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5));

  function chapterCompatible(blockCh: string, ppCh: string): boolean {
    if (!blockCh || !ppCh) return true; // si alguno es vacío, no restringe
    const a = stemOf(blockCh);
    const b = stemOf(ppCh);
    return a.some((sa) => b.includes(sa));
  }

  function flexMatch(itemName: string, ppChapter: string): MueblesRowData | undefined {
    const target = itemName.toUpperCase().trim();
    const targetStems = new Set(stemOf(target));

    // Filtrar candidatos por bloque compatible cuando hay capítulo
    const candidates = ppChapter
      ? dataRows.filter((d) => chapterCompatible(d.blockChapter, ppChapter))
      : dataRows;
    const pool = candidates.length > 0 ? candidates : dataRows;

    // Match exacto
    const exact = pool.find((d) => d.name === target);
    if (exact) return exact;
    // Substring
    const loose = pool.find(
      (d) => d.name.startsWith(target) || target.startsWith(d.name)
    );
    if (loose) return loose;
    // Match por stem
    for (const d of pool) {
      for (const stem of stemOf(d.name)) {
        if (targetStems.has(stem)) return d;
      }
    }
    return undefined;
  }

  for (let r = ppHeaderRow + 1; r < pp.length; r++) {
    const row = pp[r];
    const itemNumber = clean(row[2]);
    const partidaName = clean(row[3]);
    const descCol = clean(row[5]); // Para items: descripción general; para sub-detalles: material
    const quantity = num(row[7]);
    const total = num(row[8]);

    if (!itemNumber && !partidaName) continue;

    const partidaUpper = partidaName.toUpperCase();

    // Captura del descuento ANTES del check de sub-detail, sino se lo
    // come como detalle. El descuento aparece en partidaName tipo
    // "(-2% dcto)" justo después de "COSTO TOTAL MUEBLES".
    if (partidaUpper.includes("DCTO") || partidaUpper.includes("DESCUENTO")) {
      const m1 = partidaUpper.match(/(\d+)\s*%/);
      if (m1) discountPercent = parseFloat(m1[1]) / 100;
      continue;
    }

    // Captura de formas de pago (también antes que sub-detail)
    if (
      partidaUpper === "ANTICIPO" ||
      partidaUpper.startsWith("INICIO") ||
      partidaUpper === "SALDO"
    ) {
      const pct = num(row[4]);
      if (pct > 0) paymentTerms.push({ stage: partidaName, percentage: pct * 100 });
      continue;
    }

    // Capítulo: número entero o decimal con .0 al final ("1.0 MUEBLES DE COCINA")
    const isChapter = /^\d+(\.0)?$/.test(itemNumber) && partidaName && total > 0;
    const isItem = /^\d+\.\d+$/.test(itemNumber) && !/\.0$/.test(itemNumber);
    const isSubDetail = !itemNumber && currentItem && (partidaName || descCol);

    if (isChapter) {
      // Numeramos chapters secuencialmente por orden de aparición. El
      // Excel a veces repite "2.0" para múltiples capítulos (caso Aguirre:
      // "2.0 BANQUETA" y "2.0 MUEBLE BAÑO PRINCIPAL"). Ignoramos el número
      // del Excel para evitar colisiones.
      currentChapter = {
        chapterNumber: chapters.length + 1,
        name: partidaName.toUpperCase(),
        items: [],
      };
      chapters.push(currentChapter);
      currentItem = null;
      continue;
    }

    if (isItem && currentChapter) {
      const data = flexMatch(partidaName, currentChapter.name);
      currentItem = {
        itemNumber,
        name: partidaName.toUpperCase(),
        descriptionGeneral: descCol || undefined,
        quantity: quantity || 1,
        supplier: data?.supplier,
        costDistributor: data?.costDistributor ?? 0,
        utilityPercentage: data?.utilityPercentage ?? 0,
        clientPriceNet: data?.clientPriceNet ?? total / 1.19,
        clientPriceIva: data?.clientPriceIva ?? total,
        details: [],
      };
      currentChapter.items.push(currentItem);
      continue;
    }

    if (isSubDetail) {
      // Filas indentadas con descripción de material por componente
      const detailName = partidaName || "";
      const material = descCol;
      if (detailName || material) {
        currentItem!.details.push({
          name: detailName,
          material,
        });
      }
      continue;
    }

    // Observaciones
    if (clean(row[2]).match(/^\d+\.\s/)) {
      observations.push(clean(row[2]));
    }
  }

  const sumItems = chapters
    .flatMap((c) => c.items)
    .reduce((s, i) => s + i.clientPriceIva * i.quantity, 0);
  const afterDiscount = sumItems * (1 - discountPercent);

  return {
    chapters,
    totals: {
      sumItems,
      discountPercent,
      afterDiscount,
    },
    observations,
    paymentTerms,
  };
}

// ─── Parser de ARTEFACTOS ───────────────────────────────────────────────
// Las hojas separadas son alternativas de cotización (Bosch / Smeg / Teka).
// Solo se importan las hojas que están marcadas como versión activa
// (la versión que coincide con --version en su cabecera). Las otras son
// alternativas no elegidas y se reportan como "ignoradas".

function parseArtefactos(
  filePath: string,
  _targetVersion: string,
  ignoreSheets: string[] = []
): ParsedArtefactos {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const items: ParsedArtefactoItem[] = [];
  const ignored: string[] = [];
  let total = 0;

  const ignoreSet = new Set(ignoreSheets.map((s) => s.toUpperCase().trim()));

  for (const sheetName of wb.SheetNames) {
    if (sheetName.toUpperCase() === "MAESTRA") continue;
    if (ignoreSet.has(sheetName.toUpperCase().trim())) {
      ignored.push(`${sheetName} (excluida por --ignore-sheets)`);
      continue;
    }
    // Match parcial también: ej --ignore-sheets="HANSGROHE" matchea "HANSGROHE" pero
    // también "ARTEFACTOS SANITARIOS HG" si pongo "HG"
    const matchedIgnore = ignoreSheets.find((kw) =>
      sheetName.toUpperCase().includes(kw.toUpperCase())
    );
    if (matchedIgnore) {
      ignored.push(`${sheetName} (excluida por keyword "${matchedIgnore}")`);
      continue;
    }
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];

    // Detectar versión declarada en la hoja (info para reporte; NO se usa
    // para filtrar — los proyectos típicos de BLARQ tienen hojas de
    // distintas versiones que igual están vigentes en la "versión final"
    // del proyecto). Caso real Aguirre: hojas son V5/V4/V1 pero todas
    // siguen siendo el ppto V7 oficial según el cuadro resumen.
    let sheetVersion = "";
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      for (const cell of rows[r]) {
        const c = clean(cell).toUpperCase();
        const m = c.match(/^V(\d+)\s*COT/);
        if (m) {
          sheetVersion = `V${m[1]}`;
          break;
        }
      }
      if (sheetVersion) break;
    }

    // Encontrar cabecera "ITEM | DETALLE/MODELO | MARCA | CANTIDAD |
    // PRECIO LISTA | DCTO | TOTAL"
    let headerRow = -1;
    for (let r = 0; r < rows.length; r++) {
      const flat = rows[r].map((v) => clean(v).toUpperCase()).join("|");
      if (
        flat.includes("ITEM") &&
        (flat.includes("DETALLE") || flat.includes("MODELO")) &&
        flat.includes("PRECIO LISTA")
      ) {
        headerRow = r;
        break;
      }
    }
    if (headerRow === -1) continue; // hoja sin tabla esperada — skip

    // Determinar subcategoría por nombre de hoja
    const sheetUp = sheetName.toUpperCase();
    let subcategory = "sanitario";
    if (sheetUp.includes("COCINA") || sheetUp.includes("BOSCH") || sheetUp.includes("SMEG") || sheetUp.includes("TEKA")) {
      subcategory = "cocina";
    } else if (sheetUp.includes("ILUMINA")) {
      subcategory = "iluminacion";
    }

    // Cabeceras de room (BAÑO ANTONIA, COCINA, LOGIA) aparecen en filas
    // anteriores con el texto en alguna celda. Vamos rastreando entre la
    // cabecera y la siguiente fila no-item.
    let currentRoom = subcategory === "cocina" ? "cocina" : "bano_principal";

    // Buscar room antes del header
    for (let r = headerRow - 1; r >= Math.max(0, headerRow - 5); r--) {
      const row = rows[r];
      for (const cell of row) {
        const c = clean(cell).toUpperCase();
        if (!c) continue;
        if (c.startsWith("BAÑO") || c.startsWith("BANO")) {
          if (c.includes("VISITA")) currentRoom = "bano_visita";
          else if (c.includes("SECUNDARIO")) currentRoom = "bano_secundario";
          else currentRoom = "bano_principal";
        } else if (c === "COCINA" || c.startsWith("COCINA ")) {
          currentRoom = "cocina";
        } else if (c === "LOGIA") {
          currentRoom = "logia";
        }
      }
    }

    // Cols: B(1)? C(2)=ITEM, D(3)=DETALLE/MODELO, E(4)=MARCA,
    // F(5)=CANTIDAD, G(6)=PRECIO LISTA, H(7)=DCTO, I(8)=TOTAL,
    // L(11)=PRECIO NETO BLARQ (en hojas con esa columna)
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const itemName = clean(row[2]);
      const itemUpper = itemName.toUpperCase();
      const rowQty = num(row[5]);
      const rowTotal = num(row[8]);

      // Si encontramos otro encabezado de room, actualizar. Solo es header
      // si la fila NO tiene cantidad ni precio (de lo contrario es item
      // con ese nombre — caso real Aguirre: "COCINA" como nombre de
      // lámpara con qty=4 y precio).
      const looksLikeRoomHeader =
        rowQty === 0 &&
        rowTotal === 0 &&
        (itemUpper.startsWith("BAÑO") ||
          itemUpper.startsWith("BANO") ||
          itemUpper === "COCINA" ||
          itemUpper === "LOGIA");
      if (looksLikeRoomHeader) {
        if (itemUpper.includes("VISITA")) currentRoom = "bano_visita";
        else if (itemUpper.includes("SECUNDARIO")) currentRoom = "bano_secundario";
        else if (itemUpper.startsWith("BAÑO") || itemUpper.startsWith("BANO")) currentRoom = "bano_principal";
        else if (itemUpper === "COCINA") currentRoom = "cocina";
        else if (itemUpper === "LOGIA") currentRoom = "logia";
        continue;
      }

      if (!itemName) continue;
      if (itemUpper.startsWith("TOTAL")) continue; // "TOTAL ARTEFACTOS..."
      if (itemUpper === "ITEM") continue; // header repetida (en hoja Teka)
      // Algunos Excels (caso Arrau V5) traen una fila "IVA" con el monto
      // del IVA del bloque como si fuera un producto más. No es un
      // artefacto — la convención de la app es guardar clientPrice como
      // bruto y dejar que el sistema calcule IVA solo. Saltarla.
      if (itemUpper === "IVA") continue;

      const detail = clean(row[3]);
      const brand = clean(row[4]);
      const quantity = num(row[5]);
      const listPrice = num(row[6]);
      const discount = num(row[7]);
      const totalRow = num(row[8]);
      const realCost = num(row[11]);

      // Saltar items con cantidad 0 (no se compraron) o sin total
      if (quantity === 0 && totalRow === 0) continue;
      if (totalRow === 0 && listPrice === 0) continue;

      items.push({
        room: currentRoom,
        subcategory,
        name: itemName,
        detail: detail || undefined,
        brand: brand || undefined,
        quantity: quantity || 1,
        listPrice,
        discountPercent: discount,
        clientPrice: totalRow,
        realCostBlarq: realCost > 0 ? realCost : undefined,
      });
      total += totalRow;
    }
  }

  return { items, total, ignoredSheets: ignored };
}

// ─── Lookup project ──────────────────────────────────────────────────────

async function findProject(projectArg: string) {
  // Si parece cuid, buscar por id directo
  const byId = await prisma.project.findUnique({ where: { id: projectArg } });
  if (byId) return byId;
  // Si es número, buscar por numeroProyecto
  const asNum = parseInt(projectArg, 10);
  if (!isNaN(asNum)) {
    const byNum = await prisma.project.findFirst({
      where: { numeroProyecto: asNum },
    });
    if (byNum) return byNum;
  }
  // Buscar por name (contains)
  const byName = await prisma.project.findFirst({
    where: { name: { contains: projectArg, mode: "insensitive" } },
  });
  return byName;
}

// ─── Commit OBRA a BD ───────────────────────────────────────────────────
// Respeta regla de no duplicar partidas en PartidaCatalog.

interface CommitResult {
  budgetVersionId: string;
  partidasReused: number;
  partidasCreated: number;
  itemsCreated: number;
  itemsCustomized: number;
}

async function commitObra(
  projectId: string,
  version: string,
  parsed: ParsedObra,
  status: string = "aprobado"
): Promise<CommitResult> {
  // Pre-check: ¿ya hay un BudgetVersion con (projectId, version, type=obra)?
  const existing = await prisma.budgetVersion.findFirst({
    where: { projectId, version, type: "obra" },
  });
  if (existing) {
    throw new Error(
      `Ya existe BudgetVersion ${version} de obra para este proyecto (${existing.id}). ` +
        `Borrar manualmente antes de re-importar.`
    );
  }

  // Lookup del catálogo actual de la app (todas las partidas)
  const dbCatalog = await prisma.partidaCatalog.findMany({
    select: { id: true, category: true, name: true, unitPrice: true },
  });
  const dbByKey = new Map<string, (typeof dbCatalog)[number]>();
  for (const p of dbCatalog) {
    dbByKey.set(`${p.category}||${p.name}`, p);
  }

  // Mapa nombre del Excel → catálogo Excel parseado (para crear nuevas partidas)
  const excelCatalogByName = new Map<string, ParsedCatalogPartida>();
  for (const p of parsed.catalog) {
    excelCatalogByName.set(p.name.toUpperCase().trim(), p);
  }

  let partidasReused = 0;
  let partidasCreated = 0;
  let itemsCustomized = 0;

  // Función helper: para un item del PRESUPUESTO, devuelve el catalogPartidaId
  // (creando la partida en el catálogo si es nueva).
  const ensureCatalogPartida = async (
    it: ParsedObraItem
  ): Promise<{ catalogPartidaId: string | null; isCustomized: boolean }> => {
    const partidaName = it.partidaName;
    const nameKey = partidaName.toUpperCase().trim();

    // Buscar en el catálogo Excel para inferir categoría
    const excelPartida = excelCatalogByName.get(nameKey);
    const category = excelPartida?.category ?? it.chapter ?? "OTROS";

    const dbKey = `${category}||${partidaName}`;
    const exact = dbByKey.get(dbKey);
    if (exact) {
      partidasReused++;
      // ¿el precio del proyecto difiere del catálogo? marca isCustomized
      const drift =
        exact.unitPrice > 0
          ? Math.abs(it.unitPrice - exact.unitPrice) / exact.unitPrice
          : 0;
      return {
        catalogPartidaId: exact.id,
        isCustomized: drift > 0.02,
      };
    }

    // Buscar también por nombre solo (sin categoría) — a veces la categoría
    // del Excel difiere del catálogo de la app aunque sea la misma partida.
    const byNameOnly = dbCatalog.find(
      (p) => p.name.toUpperCase().trim() === nameKey
    );
    if (byNameOnly) {
      partidasReused++;
      const drift =
        byNameOnly.unitPrice > 0
          ? Math.abs(it.unitPrice - byNameOnly.unitPrice) / byNameOnly.unitPrice
          : 0;
      return {
        catalogPartidaId: byNameOnly.id,
        isCustomized: drift > 0.02,
      };
    }

    // No existe en catálogo → crearla. Si tenemos componentes en BASE DATOS,
    // usarlos. Si no, crear partida pelada con costos agregados del item.
    if (excelPartida) {
      const created = await prisma.partidaCatalog.create({
        data: {
          category,
          name: partidaName,
          unit: excelPartida.unit || it.unit || "UN",
          unitPrice: excelPartida.unitPrice,
          costMaterial: excelPartida.costMaterial,
          costLabor: excelPartida.costLabor,
          costMargin: excelPartida.costMargin,
          costTools: excelPartida.costTools,
          costLoss: excelPartida.costLoss,
          costSubcontract: excelPartida.costSubcontract,
          components: {
            create: excelPartida.components.map((c, idx) => ({
              type: c.type,
              description: c.description,
              unit: c.unit,
              quantity: c.quantity,
              unitCost: c.unitCost,
              totalCost: c.totalCost,
              referenceLink: c.referenceLink,
              sortOrder: idx,
            })),
          },
        },
      });
      partidasCreated++;
      // Cachear en dbByKey para futuras consultas en este mismo run
      dbByKey.set(`${created.category}||${created.name}`, {
        id: created.id,
        category: created.category,
        name: created.name,
        unitPrice: created.unitPrice,
      });
      return { catalogPartidaId: created.id, isCustomized: false };
    }

    // Sin componentes en BASE DATOS (item tipeado directo en PRESUPUESTO,
    // ej. "PROVISIÓN LUMINARIA" o las 14.x). Lo dejamos sin partida en
    // catálogo: el ObraItem queda con catalogPartidaId=null e
    // isCustomized=true. No contamina el catálogo con basura efímera.
    return { catalogPartidaId: null, isCustomized: true };
  };

  // Crear BudgetVersion + ObraItems en una transacción. Default timeout
  // de 5s no alcanza para ~70 items + posibles partidas nuevas — subimos
  // a 60s para que pase aunque Neon esté tibio.
  const result = await prisma.$transaction(
    async (tx) => {
    const bv = await tx.budgetVersion.create({
      data: {
        projectId,
        version,
        type: "obra",
        ggPercentage: parsed.percentages.gg,
        utilityPercentage: parsed.percentages.utility,
        status,
      },
    });

    let itemsCreated = 0;
    let sortOrder = 0;
    // Items "oficiales" del presupuesto pre-cierre
    for (const it of parsed.items) {
      const { catalogPartidaId, isCustomized } = await ensureCatalogPartida(it);
      if (isCustomized) itemsCustomized++;
      await tx.obraItem.create({
        data: {
          budgetVersionId: bv.id,
          chapter: normalizeChapter(it.chapter),
          itemNumber: it.itemNumber,
          name: it.partidaName,
          descriptionCliente: it.descriptionCliente,
          unit: it.unit || "UN",
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
          costMaterial: it.costMaterial,
          costLabor: it.costLabor,
          costMargin: it.costMargin,
          costTools: it.costTools,
          costLoss: it.costLoss,
          costSubcontract: it.costSubcontract,
          sortOrder: sortOrder++,
          catalogPartidaId,
          isCustomized,
        },
      });
      itemsCreated++;
    }

    // Items "extras" post-cierre: NO se cargan. Decisión 2026-05-05 con MJ.
    // Razón: el Excel a veces tiene filas tipeadas después del TOTAL MANO
    // DE OBRA que son leftovers de versiones viejas o adicionales tipeados
    // sueltos. No representan parte del presupuesto V4 oficial. Se reportan
    // en el dry-run para que MJ los vea, pero no se persisten.

    return {
      budgetVersionId: bv.id,
      itemsCreated,
    };
    },
    { timeout: 60000, maxWait: 10000 }
  );

  return {
    budgetVersionId: result.budgetVersionId,
    partidasReused,
    partidasCreated,
    itemsCreated: result.itemsCreated,
    itemsCustomized,
  };
}

// ─── Commit MUEBLES a BD ────────────────────────────────────────────────

async function commitMuebles(
  projectId: string,
  version: string,
  parsed: ParsedMuebles,
  status: string = "aprobado"
): Promise<{ budgetVersionId: string; chaptersCreated: number; itemsCreated: number }> {
  const existing = await prisma.budgetVersion.findFirst({
    where: { projectId, version, type: "muebles" },
  });
  if (existing) {
    throw new Error(
      `Ya existe BudgetVersion ${version} de muebles para este proyecto (${existing.id}).`
    );
  }

  return prisma.$transaction(async (tx) => {
    const observationsList = [...parsed.observations];
    const bv = await tx.budgetVersion.create({
      data: {
        projectId,
        version,
        type: "muebles",
        status,
        // Descuento global guardado como decimal (0.02 = 2%) para que
        // metrics.ts lo aplique al subtotal de muebles.
        discountPercentage: parsed.totals.discountPercent || 0,
        observations: observationsList.length > 0 ? observationsList.join("\n") : null,
        paymentTerms: {
          create: parsed.paymentTerms.map((p, idx) => ({
            stage: p.stage,
            percentage: p.percentage,
            sortOrder: idx,
          })),
        },
      },
    });

    let chaptersCreated = 0;
    let itemsCreated = 0;

    for (const ch of parsed.chapters) {
      const chapter = await tx.muebleChapter.create({
        data: {
          budgetVersionId: bv.id,
          chapterNumber: ch.chapterNumber,
          name: ch.name,
          sortOrder: ch.chapterNumber,
        },
      });
      chaptersCreated++;

      for (let idx = 0; idx < ch.items.length; idx++) {
        const it = ch.items[idx];
        await tx.muebleItem.create({
          data: {
            budgetVersionId: bv.id,
            chapterId: chapter.id,
            itemNumber: it.itemNumber,
            name: it.name,
            descriptionGeneral: it.descriptionGeneral,
            quantity: it.quantity,
            supplier: it.supplier,
            costDistributor: it.costDistributor,
            utilityPercentage: it.utilityPercentage,
            clientPriceNet: it.clientPriceNet,
            clientPriceIva: it.clientPriceIva,
            sortOrder: idx,
            details: {
              create: it.details.map((d, dIdx) => ({
                name: d.name,
                material: d.material,
                sortOrder: dIdx,
              })),
            },
          },
        });
        itemsCreated++;
      }
    }

    return { budgetVersionId: bv.id, chaptersCreated, itemsCreated };
  }, { timeout: 60000, maxWait: 10000 });
}

// ─── Commit ARTEFACTOS a BD ─────────────────────────────────────────────

async function commitArtefactos(
  projectId: string,
  version: string,
  parsed: ParsedArtefactos,
  status: string = "aprobado"
): Promise<{ budgetVersionId: string; itemsCreated: number }> {
  const existing = await prisma.budgetVersion.findFirst({
    where: { projectId, version, type: "artefactos" },
  });
  if (existing) {
    throw new Error(
      `Ya existe BudgetVersion ${version} de artefactos para este proyecto (${existing.id}).`
    );
  }

  return prisma.$transaction(async (tx) => {
    const bv = await tx.budgetVersion.create({
      data: {
        projectId,
        version,
        type: "artefactos",
        status,
      },
    });

    let itemsCreated = 0;
    for (let idx = 0; idx < parsed.items.length; idx++) {
      const it = parsed.items[idx];
      await tx.artefactoItem.create({
        data: {
          budgetVersionId: bv.id,
          room: it.room,
          subcategory: it.subcategory,
          name: it.name,
          detail: it.detail,
          brand: it.brand,
          quantity: it.quantity,
          listPrice: it.listPrice,
          discountPercent: it.discountPercent,
          clientPrice: it.clientPrice,
          realCostBlarq: it.realCostBlarq,
          sortOrder: idx,
        },
      });
      itemsCreated++;
    }

    return { budgetVersionId: bv.id, itemsCreated };
  }, { timeout: 60000, maxWait: 10000 });
}

// ─── MAIN ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Import budget — proyecto: ${args.project} · versión: ${args.version}`);
  console.log(`Modo: ${args.dryRun ? "DRY-RUN (sin escribir)" : "COMMIT"}`);
  console.log("=".repeat(60));

  const project = await findProject(args.project);
  if (!project) {
    console.error(`\nProyecto no encontrado: "${args.project}"`);
    process.exit(1);
  }
  console.log(`\nProyecto: #${project.numeroProyecto ?? "?"} ${project.name} (${project.id})`);
  console.log(`Cliente: ${project.clientName}`);

  // ── OBRA ──
  if (args.obra) {
    console.log(`\n── OBRA ──`);
    console.log(`Archivo: ${path.basename(args.obra)}`);
    const parsed = parseObra(args.obra);
    console.log(`\nCatálogo extraído de BASE DATOS: ${parsed.catalog.length} partidas`);
    console.log(`PRESUPUESTO: ${parsed.items.length} items`);

    // Advertir colisiones de numeración
    const collisions = (parsed.items as unknown as {
      __collisions?: { itemNumber: string; names: string[] }[];
    }).__collisions;
    if (collisions && collisions.length > 0) {
      console.log(
        `\n  Atención: ${collisions.length} item(s) con numeración duplicada y nombres distintos:`
      );
      for (const c of collisions) {
        console.log(`    ${c.itemNumber} → ${c.names.join(" + ")}`);
      }
      console.log(
        `    Se mantienen ambos. Conviene renumerar uno en el Excel para futuras versiones.`
      );
    }

    console.log(`\nTotales del Excel (hoja MAESTRA):`);
    console.log(`  Materiales:    ${fmt(parsed.totals.materiales)}`);
    console.log(`  Mano Obra:     ${fmt(parsed.totals.manoObra)}`);
    console.log(`  Margen:        ${fmt(parsed.totals.margen)}`);
    console.log(`  Herramientas:  ${fmt(parsed.totals.herramientas)}`);
    console.log(`  Pérdidas:      ${fmt(parsed.totals.perdidas)}`);
    console.log(`  Subcontrato:   ${fmt(parsed.totals.subcontrato)}`);
    console.log(`  Suma totales:  ${fmt(parsed.totals.sumaTotales)}`);
    console.log(`\nCosto directo V4 oficial (items pre-cierre):`);
    console.log(`  ${fmt(parsed.totals.presupuestoTotal)}`);

    if (parsed.extras.length > 0) {
      console.log(
        `\nExtras post-cierre del Excel (${parsed.extras.length} items, ${fmt(parsed.totals.extrasTotal)}):`
      );
      for (const e of parsed.extras) {
        console.log(
          `    ${e.itemNumber} ${e.partidaName} — total ${fmt(e.total)} = MO ${fmt(e.costLabor ?? 0)} + Mat ${fmt(e.costMaterial ?? 0)}`
        );
      }
      console.log(`    (No entran en el costo directo oficial. Se importan como ObraItem con flag de extra.)`);
    }

    // Suma agregada de costos por tipo (POR UNIDAD × quantity = total
    // agregado, igual que como lo calcula metrics.ts).
    const aggregated = parsed.items.reduce(
      (acc, it) => {
        const q = it.quantity || 0;
        acc.material += (it.costMaterial ?? 0) * q;
        acc.labor += (it.costLabor ?? 0) * q;
        acc.margin += (it.costMargin ?? 0) * q;
        acc.tools += (it.costTools ?? 0) * q;
        acc.loss += (it.costLoss ?? 0) * q;
        acc.subcontract += (it.costSubcontract ?? 0) * q;
        return acc;
      },
      { material: 0, labor: 0, margin: 0, tools: 0, loss: 0, subcontract: 0 }
    );
    console.log(`\nDesglose agregado por tipo (post-asignación):`);
    console.log(`  Materiales:    ${fmt(aggregated.material)}`);
    console.log(`  Mano Obra:     ${fmt(aggregated.labor)}`);
    console.log(`  Margen:        ${fmt(aggregated.margin)}`);
    console.log(`  Herramientas:  ${fmt(aggregated.tools)}`);
    console.log(`  Pérdidas:      ${fmt(aggregated.loss)}`);
    console.log(`  Subcontrato:   ${fmt(aggregated.subcontract)}`);
    const sumAgg =
      aggregated.material +
      aggregated.labor +
      aggregated.margin +
      aggregated.tools +
      aggregated.loss +
      aggregated.subcontract;
    console.log(`  Suma:          ${fmt(sumAgg)}  (vs PRESUPUESTO ${fmt(parsed.totals.presupuestoTotal)})`);

    // Cálculo final a c/IVA según fórmula BLARQ. Porcentajes leídos del
    // Excel (cada proyecto puede tener su propia combinación).
    const gg = parsed.percentages.gg / 100;
    const util = parsed.percentages.utility / 100;
    const iva = 0.19;
    const costoDirecto = parsed.totals.presupuestoTotal;
    const ggMonto = costoDirecto * gg;
    const utilMonto = costoDirecto * util;
    const costoNeto = costoDirecto + ggMonto + utilMonto;
    const ivaMonto = costoNeto * iva;
    const costoTotal = costoNeto + ivaMonto;
    console.log(
      `\nProyección a Costo Total (GG ${parsed.percentages.gg}% · Util ${parsed.percentages.utility}% sobre costo directo · IVA 19%):`
    );
    console.log(`  Costo directo:     ${fmt(costoDirecto)}`);
    console.log(`  + GG (${parsed.percentages.gg}%):        ${fmt(ggMonto)}`);
    console.log(`  + Utilidad (${parsed.percentages.utility}%):   ${fmt(utilMonto)}`);
    console.log(`  = Costo neto:      ${fmt(costoNeto)}`);
    console.log(`  + IVA (19%):       ${fmt(ivaMonto)}`);
    console.log(`  = Costo total:     ${fmt(costoTotal)}`);

    // Match de items con catálogo (PRESUPUESTO ↔ BASE DATOS)
    const catalogByName = new Map<string, ParsedCatalogPartida>();
    for (const p of parsed.catalog) {
      // key normalizada para match tolerante
      const k = p.name.toUpperCase().trim();
      catalogByName.set(k, p);
    }
    const matched: ParsedObraItem[] = [];
    const unmatched: ParsedObraItem[] = [];
    for (const it of parsed.items) {
      const k = it.partidaName.toUpperCase().trim();
      if (catalogByName.has(k)) matched.push(it);
      else unmatched.push(it);
    }
    console.log(`\nMatch PRESUPUESTO ↔ BASE DATOS:`);
    console.log(`  Encontradas en BASE DATOS:    ${matched.length}`);
    console.log(`  No encontradas (sin desglose): ${unmatched.length}`);

    if (unmatched.length > 0) {
      console.log(
        `\n  Items del PRESUPUESTO sin match en BASE DATOS (regla MJ: MO Excel → costLabor; resto → costMaterial):`
      );
      for (const it of unmatched.slice(0, 15)) {
        const lab = it.costLabor ?? 0;
        const mat = it.costMaterial ?? 0;
        console.log(
          `    ${it.itemNumber} ${it.partidaName} — total ${fmt(it.total)} = MO ${fmt(lab)} + Mat ${fmt(mat)}`
        );
      }
      if (unmatched.length > 15) {
        console.log(`    ... y ${unmatched.length - 15} más`);
      }
    }

    // Match contra catálogo de la BD app
    console.log(`\nMatch contra catálogo de la app:`);
    const dbCatalog = await prisma.partidaCatalog.findMany({
      select: { id: true, category: true, name: true, unitPrice: true },
    });
    const dbByKey = new Map<string, (typeof dbCatalog)[number]>();
    for (const p of dbCatalog) {
      dbByKey.set(`${p.category}||${p.name}`, p);
      // También por nombre solo (categoría puede variar)
      dbByKey.set(`*||${p.name}`, p);
    }
    let inAppCatalog = 0;
    let newToCatalog = 0;
    for (const p of parsed.catalog) {
      const exact = dbByKey.get(`${p.category}||${p.name}`);
      if (exact) inAppCatalog++;
      else newToCatalog++;
    }
    console.log(`  Partidas Excel ya en catálogo app (match exacto cat+nombre): ${inAppCatalog}`);
    console.log(`  Partidas Excel nuevas (se agregarían):                       ${newToCatalog}`);
  }

  // ── MUEBLES ──
  if (args.muebles) {
    console.log(`\n── MUEBLES ──`);
    console.log(`Archivo: ${path.basename(args.muebles)}`);
    const m = parseMuebles(args.muebles);
    const totalItems = m.chapters.reduce((s, c) => s + c.items.length, 0);
    console.log(`Capítulos: ${m.chapters.length}  ·  Items: ${totalItems}`);
    for (const ch of m.chapters) {
      console.log(`\n  ${ch.chapterNumber}. ${ch.name}`);
      for (const it of ch.items) {
        const supplier = it.supplier ? ` [${it.supplier}]` : "";
        console.log(
          `    ${it.itemNumber} ${it.name}${supplier}  ` +
            `c=${fmt(it.costDistributor)}  ` +
            `util=${(it.utilityPercentage * 100).toFixed(0)}%  ` +
            `c/iva=${fmt(it.clientPriceIva)}  ` +
            `details=${it.details.length}`
        );
      }
    }
    console.log(`\nTotal items c/IVA (sin descuento): ${fmt(m.totals.sumItems)}`);
    if (m.totals.discountPercent > 0) {
      console.log(`Descuento aplicado:  -${(m.totals.discountPercent * 100).toFixed(0)}%`);
      console.log(`Total final:         ${fmt(m.totals.afterDiscount)}`);
    }
    if (m.paymentTerms.length > 0) {
      console.log(`Formas de pago:      ${m.paymentTerms.map((p) => `${p.stage} ${p.percentage}%`).join(" / ")}`);
    }
  }

  // ── ARTEFACTOS ──
  if (args.artefactos) {
    console.log(`\n── ARTEFACTOS ──`);
    console.log(`Archivo: ${path.basename(args.artefactos)}`);
    const a = parseArtefactos(args.artefactos, args.version, args.ignoreSheets);
    console.log(`Items importados: ${a.items.length}  ·  Total: ${fmt(a.total)}`);
    if (a.ignoredSheets.length > 0) {
      console.log(`\nHojas ignoradas (versión distinta de ${args.version}):`);
      for (const s of a.ignoredSheets) console.log(`  - ${s}`);
    }
    // Agrupar por room
    const byRoom = new Map<string, typeof a.items>();
    for (const it of a.items) {
      if (!byRoom.has(it.room)) byRoom.set(it.room, []);
      byRoom.get(it.room)!.push(it);
    }
    for (const [room, items] of byRoom) {
      const subtotal = items.reduce((s, i) => s + i.clientPrice, 0);
      console.log(`\n  ${room.toUpperCase()} (${items.length} items, ${fmt(subtotal)}):`);
      for (const it of items) {
        const brand = it.brand ? ` [${it.brand}]` : "";
        console.log(
          `    ${it.name}${brand}  ${fmt(it.clientPrice)}  ` +
            (it.realCostBlarq ? `(costo BLARQ ${fmt(it.realCostBlarq)})` : "")
        );
      }
    }
  }

  if (args.dryRun) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`DRY-RUN: nada se escribió en BD. Para aplicar: --commit`);
    return;
  }

  // ─── COMMIT a BD ────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`COMMIT — escribiendo a BD`);
  console.log("=".repeat(60));

  if (args.obra) {
    const parsed = parseObra(args.obra);
    const r = await commitObra(project.id, args.version, parsed, args.status);
    console.log(
      `\nOBRA → BudgetVersion ${r.budgetVersionId}\n` +
        `  Items creados:        ${r.itemsCreated}\n` +
        `  Partidas reusadas:    ${r.partidasReused}\n` +
        `  Partidas nuevas:      ${r.partidasCreated}\n` +
        `  Items isCustomized:   ${r.itemsCustomized}`
    );
  }

  if (args.muebles) {
    const parsed = parseMuebles(args.muebles);
    const r = await commitMuebles(project.id, args.version, parsed, args.status);
    console.log(
      `\nMUEBLES → BudgetVersion ${r.budgetVersionId}\n` +
        `  Capítulos creados:  ${r.chaptersCreated}\n` +
        `  Items creados:      ${r.itemsCreated}`
    );
  }

  if (args.artefactos) {
    const parsed = parseArtefactos(args.artefactos, args.version, args.ignoreSheets);
    const r = await commitArtefactos(project.id, args.version, parsed, args.status);
    console.log(
      `\nARTEFACTOS → BudgetVersion ${r.budgetVersionId}\n` +
        `  Items creados: ${r.itemsCreated}`
    );
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`COMMIT completado.`);
}

main()
  .catch((e) => {
    console.error("\n[ERROR]", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
