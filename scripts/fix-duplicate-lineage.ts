/**
 * Corrige obra items que comparten lineageId dentro de la MISMA
 * BudgetVersion. Causa: el duplicador de partidas (para separar zonas
 * COCINA/BAÑO) copiaba el lineageId del origen. Eso rompe la creacion de
 * Estado de Pago, que exige lineageId unico por EP (@@unique
 * [estadoPagoId, lineageId]).
 *
 * Fix: al primer item de cada lineageId duplicado se le deja el lineageId
 * original; a los demas se les asigna un cuid nuevo. Son partidas
 * separadas de aca en adelante (cada zona su linea).
 *
 * Seguro: solo toca budgets que tienen el conflicto. Para proyectos con
 * EPs cerrados que referencien ese lineageId, el item que CONSERVA el
 * lineage mantiene su historial; el reasignado arranca avance 0 (correcto,
 * es una linea nueva). Igual reportamos esos casos para revisarlos.
 *
 * Uso:
 *   npx tsx scripts/fix-duplicate-lineage.ts            # dry-run
 *   npx tsx scripts/fix-duplicate-lineage.ts --apply
 *   DATABASE_URL="<prod>" npx tsx scripts/fix-duplicate-lineage.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function cuid(): string {
  // cuid simple — no hace falta el formato exacto de Prisma, solo unico.
  return "lin_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function main() {
  const budgets = await prisma.budgetVersion.findMany({
    where: { type: "obra" },
    include: {
      project: { select: { name: true } },
      obraItems: { orderBy: { sortOrder: "asc" }, select: { id: true, lineageId: true, name: true } },
    },
  });

  let totalReassign = 0;
  for (const bv of budgets) {
    const seen = new Set<string>();
    const toReassign: { id: string; name: string; oldLin: string }[] = [];
    for (const it of bv.obraItems) {
      if (seen.has(it.lineageId)) {
        toReassign.push({ id: it.id, name: it.name, oldLin: it.lineageId });
      } else {
        seen.add(it.lineageId);
      }
    }
    if (toReassign.length === 0) continue;

    // ¿Este proyecto tiene EPs que referencian estos lineageId?
    const epItems = await prisma.estadoPagoItem.count({
      where: {
        estadoPago: { projectId: bv.projectId },
        lineageId: { in: toReassign.map((t) => t.oldLin) },
      },
    });

    console.log(`\n${bv.project.name} · ${bv.version} (${bv.status}) — ${toReassign.length} a reasignar${epItems > 0 ? ` ⚠ tiene ${epItems} EP items con esos lineage` : ""}`);
    for (const t of toReassign) console.log(`   - ${t.name}`);
    totalReassign += toReassign.length;

    if (APPLY) {
      for (const t of toReassign) {
        await prisma.obraItem.update({ where: { id: t.id }, data: { lineageId: cuid() } });
      }
    }
  }
  console.log(`\n${APPLY ? "APLICADO" : "DRY-RUN"} — total items a reasignar: ${totalReassign}`);
}
main().finally(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
