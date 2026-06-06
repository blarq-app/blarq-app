import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { readdirSync, readFileSync } from "fs";

/**
 * Corrige las 6 partidas de "Con ampliación" (grupo B) para que el desglose
 * sume EXACTAMENTE el precio enviado original. El paso previo redondeó el
 * margen a 2 decimales → en las grandes (Reparación, Limpieza) el precio al
 * cliente se movió ~$10. Acá fijo el margen con precisión completa usando el
 * precio enviado ORIGINAL (del backup) como objetivo, así el P.U. vuelve a su
 * valor exacto. Solo toca el margen; materiales/MO intactos.
 *
 * --apply para escribir. Dry-run por defecto.
 */
const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const BACKDIR = "/Users/mjblanco/Desktop/blarq-app/backups";

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

const NEEDLES = ["INSTALACION_VOLCANITA", "REPARACION_GENERAL", "PINTURA_DE_MUROS", "PISO_VINILICO", "PINTURA_DE_CIELOS", "LIMPIEZA_Y_CUIDADO"];

// Lee el backup más reciente de cada partida → precio enviado ORIGINAL (target).
function originalTarget(needle: string): { id: string; unitPrice: number } | null {
  const files = readdirSync(BACKDIR).filter((f) => f.startsWith(`fix-desglose-colon-margen-${needle}-`) && f.endsWith(".json")).sort();
  if (!files.length) return null;
  const data = JSON.parse(readFileSync(`${BACKDIR}/${files[files.length - 1]}`, "utf8"));
  return { id: data.item.id, unitPrice: data.item.unitPrice };
}

async function main() {
  console.log(`modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  for (const needle of NEEDLES) {
    const orig = originalTarget(needle);
    if (!orig) { console.log(`⚠ sin backup para ${needle}`); continue; }
    const P = orig.unitPrice;
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: orig.id }, orderBy: { sortOrder: "asc" } });
    const margen = comps.find((c) => c.type === "margen");
    if (!margen) { console.log(`⚠ ${needle}: sin margen`); continue; }
    const totals = new Map(comps.map((c) => [c.id, effectiveTotal(c, comps)]));
    const D = [...totals.entries()].filter(([id]) => id !== margen.id).reduce((s, [, v]) => s + v, 0);
    const B = comps.filter((c) => c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + (totals.get(c.id) ?? 0), 0);
    const newPct = ((P - D) / B) * 100; // precisión completa, sin redondear
    const curPU = D + (totals.get(margen.id) ?? 0);
    console.log(`■ ${needle}: target=${P} | actual=${r2(curPU)} | margen ${r2(margen.quantity)}% → ${newPct}%`);
    if (!APPLY) continue;
    await prisma.obraItemComponent.update({ where: { id: margen.id }, data: { quantity: newPct } });
    await recalcObraItemFromComponents(orig.id);
    const post = await prisma.obraItem.findUniqueOrThrow({ where: { id: orig.id } });
    console.log(`   DESPUÉS P.U.=${post.unitPrice} | Δ vs target = ${r2((post.unitPrice ?? 0) - P)} ${Math.abs((post.unitPrice ?? 0) - P) < 0.01 ? "✓ EXACTO" : "⚠"}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
