/**
 * Carga el costo real del proveedor (realCostBlarq) en los ArtefactoItem de una
 * versión, a partir de un JSON de emparejamiento que arma el asistente tras leer
 * la cotización. Dry-run por defecto (imprime tabla costo vs venta vs margen);
 * escribe SOLO con --apply.
 *
 * Lee DATABASE_URL directo de .env.prod (no dotenv → evita la base VIEJA). Imprime
 * HOST y aborta si no es la viva ep-shy-morning.
 *
 * Uso (desde la raíz del repo):
 *   npx tsx .claude/skills/costo-artefactos/scripts/cargar-costos.ts <costos.json>          # dry-run
 *   npx tsx .claude/skills/costo-artefactos/scripts/cargar-costos.ts <costos.json> --apply  # escribe prod
 *
 * Formato del JSON:
 * {
 *   "project": "Paseo del Sena",
 *   "version": "V2",
 *   "ivaBasis": "gross",          // "gross" = costo CON IVA (neto×1,19) | "net" = costo SIN IVA
 *   "items": [
 *     { "itemId": "cmxxxx", "costNet": 123456, "note": "MK F1234, línea 3" }
 *   ]
 * }
 *
 * costNet = costo NETO unitario que aparece en la cotización (sin IVA). El script
 * calcula el valor a guardar según ivaBasis. Ver SKILL.md para por qué la base de
 * IVA importa (metrics.ts compara en neto; la UI muestra la ganancia en c/IVA).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const jsonPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!jsonPath) { console.error("Falta el JSON de costos. Ver cabecera del script."); process.exit(1); }

type CostRow = { itemId: string; costNet: number; note?: string };
type CostFile = { project: string; version: string; ivaBasis: "gross" | "net"; items: CostRow[] };
const cfg: CostFile = JSON.parse(readFileSync(jsonPath, "utf8"));
if (!["gross", "net"].includes(cfg.ivaBasis)) {
  console.error(`ivaBasis inválido: "${cfg.ivaBasis}". Debe ser "gross" o "net".`); process.exit(1);
}

const raw = readFileSync(".env.prod", "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) { console.error("No encontré DATABASE_URL en .env.prod"); process.exit(1); }
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const IVA = 1.19;
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL");
// realCostBlarq final según base: con IVA = neto×1,19; sin IVA = neto tal cual.
const toStored = (costNet: number) => Math.round(cfg.ivaBasis === "gross" ? costNet * IVA : costNet);

async function main() {
  console.log("HOST:", host, host.startsWith("ep-shy-morning") ? "(VIVA ✓)" : "(¡NO es la viva! abortando)");
  if (!host.startsWith("ep-shy-morning")) process.exit(1);

  const p = await prisma.project.findFirst({
    where: { name: { contains: cfg.project, mode: "insensitive" } },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!p) { console.error(`No hay proyecto que contenga "${cfg.project}"`); process.exit(1); }

  const bv = await prisma.budgetVersion.findFirst({
    where: { projectId: p.id, type: "artefactos", version: cfg.version },
    include: { artefactoItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!bv) { console.error(`No existe artefactos ${cfg.version} en ${p.name}`); process.exit(1); }

  console.log(`\n${p.name} · artefactos ${cfg.version} (${bv.status}) · ${bv.artefactoItems.length} ítems`);
  console.log(`Base de IVA del costo: ${cfg.ivaBasis === "gross" ? "CON IVA (neto×1,19)" : "SIN IVA (neto)"}\n`);

  const byId = new Map(bv.artefactoItems.map((i) => [i.id, i]));
  const rows: { it: (typeof bv.artefactoItems)[number]; stored: number; note?: string }[] = [];
  const huerfanos: CostRow[] = []; // itemId del JSON que no está en la versión

  for (const r of cfg.items) {
    const it = byId.get(r.itemId);
    if (!it) { huerfanos.push(r); continue; }
    rows.push({ it, stored: toStored(r.costNet), note: r.note });
  }

  // Tabla costo vs venta vs margen (por total = ×cantidad, en NETO para que el
  // margen sea comparable — el precio cliente está c/IVA, se divide por 1,19).
  console.log("ARTEFACTO                                  cant  costo/u   venta/u(neto)   margen/u   margen total");
  let totCosto = 0, totVentaNeto = 0;
  for (const { it, stored } of rows) {
    const ventaNetoU = (it.clientPrice ?? 0) / IVA;
    // costo comparable: si guardamos con IVA, para el margen "real" lo llevamos a neto.
    const costoNetoU = cfg.ivaBasis === "gross" ? stored / IVA : stored;
    const margenU = ventaNetoU - costoNetoU;
    totCosto += costoNetoU * it.quantity;
    totVentaNeto += ventaNetoU * it.quantity;
    const sign = margenU >= 0 ? "+" : "−";
    console.log(
      `${it.name.slice(0, 42).padEnd(42)} ${String(it.quantity).padStart(3)}  ${fmt(stored).padStart(9)}  ${fmt(ventaNetoU).padStart(12)}  ${(sign + fmt(Math.abs(margenU))).padStart(11)}  ${(sign + fmt(Math.abs(margenU * it.quantity))).padStart(13)}`
    );
  }

  // Ítems de la versión que quedan SIN costo (no venían en el JSON).
  const conCosto = new Set(rows.map((r) => r.it.id));
  const sinCosto = bv.artefactoItems.filter((i) => !conCosto.has(i.id));

  console.log("\n" + "─".repeat(96));
  console.log(`${rows.length} ítems con costo · ${sinCosto.length} sin costo · ${huerfanos.length} filas del JSON sin ítem`);
  const margenTotal = totVentaNeto - totCosto;
  console.log(`TOTAL (ítems con costo, en neto): costo ${fmt(totCosto)} · venta ${fmt(totVentaNeto)} · margen ${fmt(margenTotal)} (${totVentaNeto ? ((margenTotal / totVentaNeto) * 100).toFixed(1) : "0"}%)`);

  if (sinCosto.length) {
    console.log("\nSin costo cargado (quedan como estaban):");
    for (const it of sinCosto) console.log(`  · ${it.name}${it.brand ? " · " + it.brand : ""} (q${it.quantity})`);
  }
  if (huerfanos.length) {
    console.log("\n⚠ Filas del JSON cuyo itemId NO está en esta versión (revisar):");
    for (const h of huerfanos) console.log(`  · ${h.itemId} ${h.note ?? ""}`);
  }

  if (!APPLY) {
    console.log("\n(dry-run. Para escribir en prod, correr con --apply)");
    return;
  }

  console.log("\n--- APLICANDO (prod ep-shy-morning) ---");
  for (const { it, stored } of rows) {
    await prisma.artefactoItem.update({ where: { id: it.id }, data: { realCostBlarq: stored } });
  }
  console.log(`  ${rows.length} ArtefactoItem actualizados con realCostBlarq.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
