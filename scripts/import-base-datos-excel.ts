/**
 * Importa el desglose granular ("componentes") de un proyecto desde la
 * hoja BASE DATOS de su Excel original, pisando los ObraItemComponent
 * actuales (que fueron sembrados desde el catálogo y pueden estar
 * contaminados).
 *
 * NO toca los campos cost* del ObraItem ni el total — esos vienen de la
 * hoja PRESUPUESTO del Excel y son la verdad firmada con el cliente.
 * Solo reemplaza los componentes (snapshot por proyecto, ronda 12).
 *
 * Dry-run por defecto. Para escribir: --apply
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/import-base-datos-excel.ts \
 *     --project "Aguirre" --version "V7" --excel "/path/to/V7_OBRA.xlsx"
 *   (agregá --apply al final cuando quieras escribir)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import * as XLSX from "xlsx";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const PROJECT_NAME = arg("project");
const BUDGET_VERSION = arg("version");
const EXCEL_PATH = arg("excel");
const APPLY = process.argv.includes("--apply");

if (!PROJECT_NAME || !BUDGET_VERSION || !EXCEL_PATH) {
  console.error(
    "Faltan args: --project NAME --version V7 --excel /path/file.xlsx [--apply]"
  );
  process.exit(1);
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

const CONCEPTO_TO_TYPE: Record<string, string> = {
  "MANO OBRA": "mano_obra",
  "MANO DE OBRA": "mano_obra",
  MATERIAL: "material",
  MATERIALES: "material",
  HERRAMIENTAS: "herramientas",
  HERRAMIENTA: "herramientas",
  SUBCONTRATO: "subcontrato",
  SUBCONTRATOS: "subcontrato",
  MARGEN: "margen",
  PERDIDA: "perdida",
  PERDIDAS: "perdida",
  "PÉRDIDA": "perdida",
  "PÉRDIDAS": "perdida",
};

type Comp = {
  categoria: string;
  partida: string;
  concepto: string;
  detalle: string;
  descripcion: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  link: string | null;
};

async function main() {
  // 1. Leer Excel BASE DATOS
  const wb = XLSX.readFile(EXCEL_PATH!);
  const sheet = wb.Sheets["BASE DATOS"];
  if (!sheet) throw new Error("Hoja 'BASE DATOS' no encontrada en el Excel");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as (string | number)[][];

  // 2. Parsear filas (skip header)
  const components: Comp[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1]) continue;
    const partida = String(r[1] || "").trim();
    if (!partida) continue;
    components.push({
      categoria: String(r[0] || "").trim(),
      partida,
      concepto: String(r[4] || "").trim(),
      detalle: String(r[5] || "").trim(),
      descripcion: String(r[6] || "").trim(),
      unit: String(r[7] || "").trim() || "UN",
      quantity: Number(r[8]) || 0,
      unitCost: Number(r[9]) || 0,
      totalCost: Number(r[10]) || 0,
      link: (String(r[12] || "").trim() || null),
    });
  }

  // 3. Indexar por nombre de partida normalizado
  const byPartida = new Map<string, Comp[]>();
  for (const c of components) {
    const key = normalize(c.partida);
    if (!byPartida.has(key)) byPartida.set(key, []);
    byPartida.get(key)!.push(c);
  }

  // 4. Cargar proyecto + budget + items
  const project = await prisma.project.findFirst({
    where: { name: { contains: PROJECT_NAME!, mode: "insensitive" } },
  });
  if (!project) throw new Error(`Proyecto '${PROJECT_NAME}' no encontrado`);
  const budget = await prisma.budgetVersion.findFirst({
    where: {
      projectId: project.id,
      type: "obra",
      version: BUDGET_VERSION!,
    },
    include: {
      obraItems: {
        include: { components: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!budget)
    throw new Error(
      `Presupuesto '${BUDGET_VERSION}' tipo obra no encontrado para ${project.name}`
    );

  console.log(
    `\nProyecto: ${project.name} · Budget: ${budget.version} (${budget.status})`
  );
  console.log(
    `Items en proyecto: ${budget.obraItems.length} · Partidas distintas en BASE DATOS: ${byPartida.size}`
  );

  // 5. Match cada ObraItem contra BASE DATOS por nombre de partida
  const matched: { item: (typeof budget.obraItems)[number]; comps: Comp[] }[] = [];
  const noMatch: string[] = [];
  for (const it of budget.obraItems) {
    const key = normalize(it.name);
    const comps = byPartida.get(key);
    if (!comps || comps.length === 0) {
      noMatch.push(`${it.itemNumber} ${it.name}`);
      continue;
    }
    matched.push({ item: it, comps });
  }

  console.log(
    `\nMatched: ${matched.length} · Sin match: ${noMatch.length}`
  );
  if (noMatch.length > 0) {
    console.log("\nItems del proyecto SIN match en BASE DATOS:");
    for (const n of noMatch) console.log(`  ${n}`);
  }

  // 6. Comparar drift por item
  console.log(
    "\n" +
      "=".repeat(120) +
      "\nDIFERENCIAS POR ITEM (top 10 con más drift entre actual y Excel)\n" +
      "=".repeat(120)
  );

  type Diff = {
    itemNumber: string;
    name: string;
    qty: number;
    currentSum: number;
    excelSum: number;
    snapItemTotal: number; // (cost*) × qty
  };
  const diffs: Diff[] = [];
  for (const { item, comps } of matched) {
    const currentSum = item.components.reduce(
      (s, c) => s + (c.totalCost ?? 0),
      0
    );
    const excelSum = comps.reduce((s, c) => s + c.totalCost, 0);
    const snapItem =
      (item.costMaterial ?? 0) +
      (item.costLabor ?? 0) +
      (item.costTools ?? 0) +
      (item.costSubcontract ?? 0) +
      (item.costLoss ?? 0) +
      (item.costMargin ?? 0);
    diffs.push({
      itemNumber: item.itemNumber,
      name: item.name,
      qty: item.quantity,
      currentSum,
      excelSum,
      snapItemTotal: snapItem,
    });
  }
  const top = [...diffs]
    .sort(
      (a, b) =>
        Math.abs(b.excelSum - b.currentSum) -
        Math.abs(a.excelSum - a.currentSum)
    )
    .slice(0, 10);
  console.log(
    `  ${"item".padEnd(8)}  ${"nombre".padEnd(40)}  ${"qty".padStart(5)}  ${"actual".padStart(12)}  ${"excel".padStart(12)}  ${"snap cost*".padStart(12)}  diff`
  );
  for (const d of top) {
    console.log(
      `  ${d.itemNumber.padEnd(8)}  ${d.name.slice(0, 40).padEnd(40)}  ${String(d.qty).padStart(5)}  ${Math.round(d.currentSum).toLocaleString("es-CL").padStart(12)}  ${Math.round(d.excelSum).toLocaleString("es-CL").padStart(12)}  ${Math.round(d.snapItemTotal).toLocaleString("es-CL").padStart(12)}  ${Math.round(d.excelSum - d.currentSum).toLocaleString("es-CL").padStart(10)}`
    );
  }

  // Totales agregados (por unidad y por item.quantity)
  const sumActual = diffs.reduce((s, d) => s + d.currentSum * d.qty, 0);
  const sumExcel = diffs.reduce((s, d) => s + d.excelSum * d.qty, 0);
  const sumSnap = diffs.reduce((s, d) => s + d.snapItemTotal * d.qty, 0);
  console.log(
    `\nTOTALES proyecto (× cantidad de partida):\n  Actual (components hoy):    ${Math.round(sumActual).toLocaleString("es-CL")}\n  Si importáramos Excel:      ${Math.round(sumExcel).toLocaleString("es-CL")}\n  Snapshot cost* (Excel firm):${Math.round(sumSnap).toLocaleString("es-CL")}`
  );

  if (!APPLY) {
    console.log(
      "\n(dry-run. Para escribir los components reales en la BD, correr con --apply al final)"
    );
    return;
  }

  // 7. APPLY: borrar y recrear components de los matched
  console.log("\n--- APLICANDO CAMBIOS ---");
  let totalCreated = 0;
  for (const { item, comps } of matched) {
    // Borrar components existentes
    await prisma.obraItemComponent.deleteMany({
      where: { obraItemId: item.id },
    });
    // Crear nuevos
    let sortOrder = 0;
    for (const c of comps) {
      const conceptUp = c.concepto.toUpperCase();
      const type = CONCEPTO_TO_TYPE[conceptUp];
      if (!type) {
        console.warn(
          `  ⚠ concepto desconocido '${c.concepto}' en partida '${c.partida}' — se omite`
        );
        continue;
      }
      await prisma.obraItemComponent.create({
        data: {
          obraItemId: item.id,
          type,
          description: c.detalle || c.partida,
          unit: c.unit,
          quantity: c.quantity,
          unitCost: c.unitCost,
          totalCost: c.totalCost,
          referenceLink: c.link,
          sortOrder: sortOrder++,
          isCustomized: false,
        },
      });
      totalCreated++;
    }
  }
  // Items sin match: borramos sus components actuales (mejor sin desglose
  // que con desglose engañoso heredado del catálogo). MJ los va a
  // completar a mano desde la app si quiere.
  let totalDeletedForNoMatch = 0;
  for (const { item } of [] as { item: (typeof budget.obraItems)[number] }[]) {
    void item;
  }
  for (const it of budget.obraItems) {
    if (matched.some((m) => m.item.id === it.id)) continue;
    const res = await prisma.obraItemComponent.deleteMany({
      where: { obraItemId: it.id },
    });
    totalDeletedForNoMatch += res.count;
  }

  console.log(
    `  Items con match procesados: ${matched.length} · Components creados: ${totalCreated}`
  );
  console.log(
    `  Items sin match: ${noMatch.length} · Components borrados: ${totalDeletedForNoMatch}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
