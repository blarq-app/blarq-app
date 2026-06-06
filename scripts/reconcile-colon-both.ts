import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * Reconcilia las DOS versiones de Depto Colon (Con ampliación + editada sin
 * ampliación) con la regla segura: MATERIALES y MANO DE OBRA intactos, ajustar
 * SOLO el margen para que el desglose sume el precio de cada partida.
 *
 * - Cada partida se cuadra contra SU PROPIO precio (no importa si las dos
 *   versiones tienen precios distintos).
 * - Si el costo ya supera el precio (margen negativo) → NO la toca, la marca
 *   como "DECISIÓN MJ".
 * - Los retiros de pura mano de obra (la diferencia es "del maestro", no margen)
 *   se EXCLUYEN: se deciden aparte. Lista EXCLUDE abajo.
 *
 * Dry-run por defecto. --apply escribe. Backup por partida. Precisión completa.
 */
const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const host = () => (process.env.DATABASE_URL || "").match(/@([^/.]+)/)?.[1] ?? "?";

// Retiros de pura mano de obra → se deciden aparte (maestro vs margen).
const EXCLUDE = ["RETIRO PISO MADERA", "RETIRO GUARDAPOLVO", "RETIRO PISO CERAMICO", "INSTALACION LUMINARIA"];

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

async function processVersion(versionId: string, label: string) {
  const items = await prisma.obraItem.findMany({ where: { budgetVersionId: versionId }, orderBy: [{ chapter: "asc" }, { itemNumber: "asc" }] });
  const fixed: string[] = [], flagged: string[] = [], excluded: string[] = [];
  for (const it of items) {
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id }, orderBy: { sortOrder: "asc" } });
    const totals = new Map(comps.map((c) => [c.id, effectiveTotal(c, comps)]));
    const sum = [...totals.values()].reduce((s, v) => s + v, 0);
    const P = it.unitPrice ?? 0;
    if (Math.abs(P - sum) <= 1) continue; // ya cuadra
    const name = it.name.trim().toUpperCase();
    if (EXCLUDE.some((e) => name.includes(e))) { excluded.push(`${it.itemNumber} ${it.name}`); continue; }
    const margen = comps.find((c) => c.type === "margen");
    const D = margen ? sum - (totals.get(margen.id) ?? 0) : sum;
    const B = comps.filter((c) => c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + (totals.get(c.id) ?? 0), 0);
    const Mn = P - D;
    if (!margen || Mn < -0.5 || !(B > 0)) {
      flagged.push(`${it.itemNumber} ${it.name}  (precio ${r2(P)} < costo ${r2(D)}  → margen negativo ${r2(Mn)})`);
      continue;
    }
    const newPct = (Mn / B) * 100;
    fixed.push(`${it.itemNumber} ${it.name}: margen ${r2(margen.quantity)}% → ${r2(newPct)}% (precio ${r2(P)} intacto)`);
    if (APPLY) {
      const stamp = process.env.STAMP || "manual";
      writeFileSync(`/Users/mjblanco/Desktop/blarq-app/backups/reconcile-colon-${label}-${it.name.replace(/\W+/g, "_").slice(0, 24)}-${stamp}.json`, JSON.stringify({ it, comps }, null, 2));
      await prisma.obraItemComponent.update({ where: { id: margen.id }, data: { quantity: newPct } });
      await recalcObraItemFromComponents(it.id);
    }
  }
  console.log(`\n===== ${label} =====`);
  console.log(`✅ Cuadradas moviendo margen (${fixed.length}):`); fixed.forEach((f) => console.log("   " + f));
  console.log(`⚠ DECISIÓN MJ — costo > precio (${flagged.length}):`); flagged.forEach((f) => console.log("   " + f));
  console.log(`⏭ Retiros excluidos (se deciden aparte) (${excluded.length}):`); excluded.forEach((f) => console.log("   " + f));
}

async function main() {
  console.log(`Host: ${host()} — modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const proj = await prisma.project.findFirst({ where: { name: { contains: "Colon", mode: "insensitive" } }, select: { id: true } });
  const con = await prisma.budgetVersion.findFirst({ where: { projectId: proj!.id, version: { contains: "Con ampliaci", mode: "insensitive" } }, select: { id: true } });
  const edi = await prisma.budgetVersion.findFirst({ where: { projectId: proj!.id, version: { contains: "editada sin", mode: "insensitive" } }, select: { id: true } });
  await processVersion(con!.id, "CON_ampliacion");
  await processVersion(edi!.id, "EDITADA_sin_ampliacion");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
