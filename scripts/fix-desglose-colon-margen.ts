import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * Reconcilia partidas de Depto Colon "V1_Con ampliación" dejando MATERIALES y
 * MANO DE OBRA intactos (la lista de compra NO se toca) y ajustando SOLO el
 * margen para que el desglose sume el precio enviado. Decisión de MJ para los
 * grupos A (retiros, la diferencia va a margen) y B (materiales, ajustar margen).
 *
 * Candado: si el margen tuviera que quedar NEGATIVO (el costo ya supera el
 * precio), NO se aplica esa partida y se avisa — MJ la decide aparte.
 *
 * Dry-run por defecto. --apply para escribir. Backup por partida.
 */

const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const host = () => (process.env.DATABASE_URL || "").match(/@([^/.]+)/)?.[1] ?? "?";

// Espejo EXACTO de effectiveTotal en src/lib/catalog/recalcObraItem.ts.
function effectiveTotal(comp: ObraItemComponent, all: ObraItemComponent[]): number {
  const pct = comp.quantity || 0;
  if (comp.unit !== "%") return (comp.quantity || 0) * (comp.unitCost || 0);
  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const t = all.find((c) => c.id === comp.appliedToComponentId);
    return t ? effectiveTotal(t, all) * (pct / 100) : 0;
  }
  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = all.filter((c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id).reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }
  if (comp.type === "margen") {
    const base = all.filter((c) => c.id !== comp.id && c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }
  return (comp.quantity || 0) * (comp.unitCost || 0);
}

// Las 6 que llevan materiales (grupo B, aprobadas): ajustar solo el margen.
// Los 3 retiros (1.2/1.3/1.5) se deciden aparte (uno por uno).
const TARGETS = [
  "INSTALACION VOLCANITA", "REPARACION GENERAL", "PINTURA DE MUROS",
  "PISO VINILICO", "PINTURA DE CIELOS", "LIMPIEZA Y CUIDADO",
];

async function main() {
  console.log(`Host: ${host()} — modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const version = await prisma.budgetVersion.findFirst({
    where: { version: { contains: "Con ampliaci", mode: "insensitive" }, project: { name: { contains: "Colon", mode: "insensitive" } } },
    select: { id: true, status: true },
  });
  if (!version || !["borrador", "enviado"].includes(version.status)) throw new Error("Versión no editable");

  const flagged: string[] = [];
  for (const needle of TARGETS) {
    const item = await prisma.obraItem.findFirst({ where: { budgetVersionId: version.id, name: { contains: needle, mode: "insensitive" } } });
    if (!item) { console.log(`⚠ no encontré "${needle}"`); continue; }
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: item.id }, orderBy: { sortOrder: "asc" } });
    const margen = comps.find((c) => c.type === "margen");
    const P = item.unitPrice ?? 0;
    const totals = new Map(comps.map((c) => [c.id, effectiveTotal(c, comps)]));
    const T = [...totals.values()].reduce((s, v) => s + v, 0);

    if (!margen) { console.log(`\n■ ${item.name}: SIN línea de margen → no aplico (revisar). precio=${r2(P)} desg=${r2(T)}`); flagged.push(item.name); continue; }
    const Mc = totals.get(margen.id) ?? 0;
    const D = T - Mc;                 // todo menos el margen (costo real)
    const B = comps.filter((c) => c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + (totals.get(c.id) ?? 0), 0); // base del %
    const Mn = P - D;                 // margen necesario para cuadrar
    const newPct = B > 0 ? (Mn / B) * 100 : NaN;

    console.log(`\n■ ${item.name}`);
    console.log(`  precio enviado=${r2(P)} | desglose=${r2(T)} | costo (sin margen)=${r2(D)} | margen actual=${r2(Mc)} (${r2(margen.quantity)}%)`);

    if (Mn < -0.5) {
      console.log(`  ⚠ El costo (${r2(D)}) YA SUPERA el precio (${r2(P)}) → el margen quedaría NEGATIVO (${r2(Mn)}). NO la aplico — la decidís aparte.`);
      flagged.push(item.name);
      continue;
    }
    if (!(B > 0)) { console.log(`  ⚠ Sin base para %, no aplico.`); flagged.push(item.name); continue; }
    console.log(`  → margen: ${r2(margen.quantity)}% → ${r2(newPct)}%  (de ${r2(Mc)} a ${r2(Mn)})  | nuevo total = ${r2(D + Mn)} = precio ✓`);

    if (!APPLY) continue;
    const stamp = process.env.STAMP || "manual";
    writeFileSync(`/Users/mjblanco/Desktop/blarq-app/backups/fix-desglose-colon-margen-${needle.replace(/\s+/g, "_")}-${stamp}.json`, JSON.stringify({ item, comps }, null, 2));
    await prisma.obraItemComponent.update({ where: { id: margen.id }, data: { quantity: r2(newPct), isCustomized: true } });
    await recalcObraItemFromComponents(item.id);
    const post = await prisma.obraItem.findUniqueOrThrow({ where: { id: item.id } });
    const ok = Math.abs((post.unitPrice ?? 0) - P) < 1;
    console.log(`  DESPUÉS → P.U.=${r2(post.unitPrice ?? 0)} ${ok ? "✓ cuadra, precio al cliente intacto" : "⚠ NO cuadra — revisar"}`);
  }

  if (flagged.length) console.log(`\n⚠ Quedaron para decidir aparte (margen negativo / sin margen): ${flagged.join(" · ")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
