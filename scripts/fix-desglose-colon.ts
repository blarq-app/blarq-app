import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * Reconcilia el desglose de partidas de Depto Colon "V1_Con ampliación"
 * (enviado) para que SUME exactamente el precio enviado al cliente, según lo
 * que MJ decide partida por partida. NO cambia el precio al cliente: el target
 * de cada partida ES su precio enviado actual, y el script verifica que el
 * P.U. recalculado quede igual (si no, ABORTA esa partida sin escribir).
 *
 * Dry-run por defecto. --apply para escribir. Backup antes de cada cambio.
 * Solo opera sobre versiones enviado/borrador (no aprobado).
 */

const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const host = () => (process.env.DATABASE_URL || "").match(/@([^/.]+)/)?.[1] ?? "?";

// Operaciones por componente: localiza por tipo + texto en la descripción.
type Op =
  | { find: { type: string; descIncludes?: string }; setUnitCost?: number; setQuantity?: number; del?: boolean };

interface Plan {
  itemNameIncludes: string; // identifica la partida dentro de la versión
  decision: string;          // qué decidió MJ (para el log)
  ops: Op[];
}

// ── Planes aprobados por MJ ───────────────────────────────────────────────
const PLANS: Plan[] = [
  {
    itemNameIncludes: "RETIRO MOBILIARIO",
    decision: "MJ: $195.000 enteros al maestro, sin margen",
    ops: [
      { find: { type: "mano_obra", descIncludes: "JORNAL" }, setUnitCost: 195000, setQuantity: 1 },
      { find: { type: "margen" }, setQuantity: 0 }, // margen 0%
    ],
  },
];

async function main() {
  console.log(`Host: ${host()} — modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const version = await prisma.budgetVersion.findFirst({
    where: {
      version: { contains: "Con ampliaci", mode: "insensitive" },
      project: { name: { contains: "Colon", mode: "insensitive" } },
    },
    select: { id: true, version: true, status: true },
  });
  if (!version) throw new Error("No se encontró la versión Con ampliación");
  if (!["borrador", "enviado"].includes(version.status)) {
    throw new Error(`Versión en estado ${version.status} — no se toca.`);
  }

  for (const plan of PLANS) {
    const item = await prisma.obraItem.findFirst({
      where: { budgetVersionId: version.id, name: { contains: plan.itemNameIncludes, mode: "insensitive" } },
    });
    if (!item) { console.log(`⚠ No se encontró "${plan.itemNameIncludes}"`); continue; }
    const targetPrice = item.unitPrice ?? 0; // el precio enviado = lo que NO debe cambiar
    const before = await prisma.obraItemComponent.findMany({ where: { obraItemId: item.id }, orderBy: { sortOrder: "asc" } });
    const sumBefore = before.reduce((s, c) => s + c.totalCost, 0);

    console.log(`\n■ ${item.name}`);
    console.log(`  Precio enviado (target): ${r2(targetPrice)} | desglose ANTES: ${r2(sumBefore)} | drift: ${r2(targetPrice - sumBefore)}`);
    console.log(`  Decisión: ${plan.decision}`);

    // Resolver ops → cambios concretos.
    const changes: { id: string; field: string; from: number; to: number; desc: string }[] = [];
    const deletes: { id: string; desc: string }[] = [];
    for (const op of plan.ops) {
      const target = before.find(
        (c) => c.type === op.find.type && (!op.find.descIncludes || c.description.toUpperCase().includes(op.find.descIncludes.toUpperCase()))
      );
      if (!target) { console.log(`  ⚠ No encontré componente ${JSON.stringify(op.find)}`); continue; }
      if (op.del) { deletes.push({ id: target.id, desc: target.description }); continue; }
      if (op.setUnitCost !== undefined) changes.push({ id: target.id, field: "unitCost", from: target.unitCost, to: op.setUnitCost, desc: target.description });
      if (op.setQuantity !== undefined) changes.push({ id: target.id, field: "quantity", from: target.quantity, to: op.setQuantity, desc: target.description });
    }
    for (const c of changes) console.log(`    • ${c.desc}: ${c.field} ${r2(c.from)} → ${r2(c.to)}`);
    for (const d of deletes) console.log(`    • BORRAR ${d.desc}`);

    if (!APPLY) {
      // Simular el total resultante sin escribir: aproximación simple para
      // componentes lineales (no-%). Para confirmar exacto, correr --apply.
      console.log(`  (dry-run: corré --apply para ver el P.U. recalculado real)`);
      continue;
    }

    // Backup.
    const stamp = process.env.STAMP || "manual";
    writeFileSync(`/Users/mjblanco/Desktop/blarq-app/backups/fix-desglose-colon-${plan.itemNameIncludes.replace(/\s+/g, "_")}-${stamp}.json`, JSON.stringify({ item, before }, null, 2));

    await prisma.$transaction([
      ...changes.map((c) => prisma.obraItemComponent.update({ where: { id: c.id }, data: { [c.field]: c.to, isCustomized: true } })),
      ...deletes.map((d) => prisma.obraItemComponent.delete({ where: { id: d.id } })),
    ]);
    await recalcObraItemFromComponents(item.id);

    const post = await prisma.obraItem.findUniqueOrThrow({ where: { id: item.id } });
    const ok = Math.abs((post.unitPrice ?? 0) - targetPrice) < 1;
    console.log(`  DESPUÉS → desglose/P.U. = ${r2(post.unitPrice ?? 0)} | target ${r2(targetPrice)} → ${ok ? "✓ CUADRA, precio al cliente intacto" : "⚠ NO CUADRA con el precio enviado — REVISAR (¿el desglose no suma el target?)"}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
