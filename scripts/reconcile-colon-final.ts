import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * Reconciliación final de las DOS versiones de Depto Colon. Cuadra el desglose
 * con el precio de cada partida, SIN cambiar el precio al cliente:
 *   - RETIROS (mano de obra): todo al maestro (jornal = precio), margen 0.
 *   - RESTO (con materiales): materiales y MO intactos, ajusto solo el margen.
 *   - SOSPECHOSAS (Sanitarias/Enlucido/Luminaria): NO se tocan (las revisa MJ).
 *   - Si el costo ya supera el precio (margen negativo): NO se toca, se marca.
 *
 * Gatillo de "descuadrada" = suma de totales GUARDADOS ≠ precio (lo que MJ ve).
 * Dry-run por defecto. --apply escribe. Backup por partida. Precisión completa.
 */
const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const host = () => (process.env.DATABASE_URL || "").match(/@([^/.]+)/)?.[1] ?? "?";

const SUSPICIOUS = ["SANITARIAS", "ENLUCIDO", "LUMINARIA"];
const RETIROS = ["RETIRO PISO CERAMICO", "RETIRO PISO MADERA", "RETIRO GUARDAPOLVO", "RETIRO MOBILIARIO"];

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
  const done: string[] = [], suyas: string[] = [], flag: string[] = [];
  for (const it of items) {
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id }, orderBy: { sortOrder: "asc" } });
    const storedSum = comps.reduce((s, c) => s + c.totalCost, 0);
    const P = it.unitPrice ?? 0;
    if (Math.abs(P - storedSum) <= 1) continue; // MJ la ve cuadrada
    const name = it.name.trim().toUpperCase();
    if (SUSPICIOUS.some((s) => name.includes(s))) { suyas.push(`${it.itemNumber} ${it.name}`); continue; }

    const totals = new Map(comps.map((c) => [c.id, effectiveTotal(c, comps)]));
    const margen = comps.find((c) => c.type === "margen");
    const isRetiro = RETIROS.some((r) => name.includes(r));

    if (isRetiro) {
      // Todo al maestro: margen 0, jornal absorbe. (leyes 0% en estos retiros)
      const leyesActiva = comps.some((c) => c.type === "mano_obra" && c.unit === "%" && (c.quantity || 0) > 0);
      const jornal = comps.filter((c) => c.type === "mano_obra" && c.unit !== "%").sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))[0];
      if (!jornal || leyesActiva) { flag.push(`${it.itemNumber} ${it.name} (retiro sin jornal claro / leyes activa)`); continue; }
      const otrosFijos = comps.filter((c) => c.type !== "margen" && c.id !== jornal.id).reduce((s, c) => s + (totals.get(c.id) ?? 0), 0);
      const jornalNuevo = P - otrosFijos;
      if (jornalNuevo < -0.5) { flag.push(`${it.itemNumber} ${it.name} (otros costos ya superan el precio)`); continue; }
      done.push(`${it.itemNumber} ${it.name}: TODO AL MAESTRO → jornal ${r2((totals.get(jornal.id) ?? 0))} → ${r2(jornalNuevo)}, margen → 0 (precio ${r2(P)} intacto)`);
      if (APPLY) {
        const stamp = process.env.STAMP || "manual";
        writeFileSync(`/Users/mjblanco/Desktop/blarq-app/backups/reconcile-colon-final-${label}-${name.replace(/\W+/g, "_").slice(0, 22)}-${stamp}.json`, JSON.stringify({ it, comps }, null, 2));
        const tx: any[] = [prisma.obraItemComponent.update({ where: { id: jornal.id }, data: { unitCost: jornalNuevo / (jornal.quantity || 1), isCustomized: true } })];
        if (margen) tx.push(prisma.obraItemComponent.update({ where: { id: margen.id }, data: { quantity: 0 } }));
        await prisma.$transaction(tx);
        await recalcObraItemFromComponents(it.id);
      }
    } else {
      // Resto: ajustar margen, costos intactos.
      const D = margen ? [...totals.entries()].filter(([id]) => id !== margen.id).reduce((s, [, v]) => s + v, 0) : storedSum;
      const B = comps.filter((c) => c.type !== "margen" && c.type !== "perdida").reduce((s, c) => s + (totals.get(c.id) ?? 0), 0);
      const Mn = P - D;
      if (!margen || Mn < -0.5 || !(B > 0)) { flag.push(`${it.itemNumber} ${it.name} (costo ${r2(D)} > precio ${r2(P)} → margen negativo)`); continue; }
      const newPct = (Mn / B) * 100;
      done.push(`${it.itemNumber} ${it.name}: margen ${r2(margen.quantity)}% → ${r2(newPct)}% (precio ${r2(P)} intacto)`);
      if (APPLY) {
        const stamp = process.env.STAMP || "manual";
        writeFileSync(`/Users/mjblanco/Desktop/blarq-app/backups/reconcile-colon-final-${label}-${name.replace(/\W+/g, "_").slice(0, 22)}-${stamp}.json`, JSON.stringify({ it, comps }, null, 2));
        await prisma.obraItemComponent.update({ where: { id: margen.id }, data: { quantity: newPct } });
        await recalcObraItemFromComponents(it.id);
      }
    }
  }
  console.log(`\n===== ${label} =====`);
  console.log(`✅ Cuadro yo (${done.length}):`); done.forEach((d) => console.log("   " + d));
  console.log(`👤 Las revisás vos — sospechosas (${suyas.length}):`); suyas.forEach((d) => console.log("   " + d));
  console.log(`⚠ Margen negativo, no toco (${flag.length}):`); flag.forEach((d) => console.log("   " + d));
}

async function main() {
  console.log(`Host: ${host()} — modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const proj = await prisma.project.findFirst({ where: { name: { contains: "Colon", mode: "insensitive" } }, select: { id: true } });
  const con = await prisma.budgetVersion.findFirst({ where: { projectId: proj!.id, version: { contains: "Con ampliaci", mode: "insensitive" } }, select: { id: true } });
  const edi = await prisma.budgetVersion.findFirst({ where: { projectId: proj!.id, version: { contains: "editada sin", mode: "insensitive" } }, select: { id: true } });
  await processVersion(con!.id, "CON");
  await processVersion(edi!.id, "EDI");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
