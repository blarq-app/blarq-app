// Corrige el GG/Utilidad invertidos en 2 presupuestos de obra (confirmado por
// MJ 2026-06-16):
//   - Francisco de Aguirre V7:   GG 5/Util 18  → GG 18/Util 5
//   - Ampliación Casa Arrau V5:  GG 10/Util 20 → GG 20/Util 10
//
// Swappear GG↔Util NO cambia el total al cliente (la fórmula
// (1+gg)(1+util) es simétrica). El script lo VERIFICA: calcula el "acordado"
// de obra antes y después y aborta si se movió.
//
// DRY-RUN por defecto. Para aplicar:
//   npx tsx scripts/fix-gg-util-invertidos.ts --apply
// Apunta a .env.prod.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prodUrl = readFileSync(".env.prod", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  ?.replace(/^DATABASE_URL=/, "").replace(/^["']|["']$/g, "").trim();
if (!prodUrl?.includes("ep-shy-morning")) throw new Error("falta URL prod");
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

// Correcciones a aplicar: project name (contains) + version + nuevos %.
const FIXES = [
  { projectName: "Francisco de Aguirre", version: "V7", gg: 18, util: 5 },
  { projectName: "Ampliacion Casa Arrau", version: "V5", gg: 20, util: 10 },
];

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Acordado de obra de una versión = CD × (1+gg) × (1+util) × 1.19.
function acordado(cd: number, gg: number, util: number) {
  return cd * (1 + gg / 100) * (1 + util / 100) * 1.19;
}

async function main() {
  console.log(APPLY ? ">>> APLICAR (escribe en prod)" : ">>> DRY-RUN (no escribe)");
  console.log("=".repeat(70));

  for (const fix of FIXES) {
    const bv = await prisma.budgetVersion.findFirst({
      where: {
        type: "obra",
        version: fix.version,
        project: { name: { contains: fix.projectName } },
      },
      include: { obraItems: { select: { total: true } }, project: { select: { name: true } } },
    });
    if (!bv) {
      console.log(`✗ No encontré ${fix.projectName} ${fix.version} (obra)`);
      continue;
    }

    const cd = bv.obraItems.reduce((s, i) => s + i.total, 0);
    const ggOld = bv.ggPercentage ?? 0;
    const utilOld = bv.utilityPercentage ?? 0;
    const acordadoAntes = acordado(cd, ggOld, utilOld);
    const acordadoDespues = acordado(cd, fix.gg, fix.util);

    console.log(`\n${bv.project?.name} ${bv.version}`);
    console.log(`  costo directo: ${fmt(cd)}`);
    console.log(`  antes:   GG ${ggOld}% / Util ${utilOld}%  → acordado ${fmt(acordadoAntes)}`);
    console.log(`  después: GG ${fix.gg}% / Util ${fix.util}%  → acordado ${fmt(acordadoDespues)}`);

    // Guardia §4.1: el total al cliente NO debe moverse.
    if (Math.round(acordadoAntes) !== Math.round(acordadoDespues)) {
      console.log(`  ✗ ABORTO: el acordado cambió (${fmt(acordadoAntes)} → ${fmt(acordadoDespues)}). No se toca.`);
      continue;
    }
    console.log(`  ✓ acordado idéntico — corrección segura`);

    if (APPLY) {
      await prisma.budgetVersion.update({
        where: { id: bv.id },
        data: { ggPercentage: fix.gg, utilityPercentage: fix.util },
      });
      console.log(`  ✓ aplicado`);
    }
  }

  if (!APPLY) console.log(`\nDRY-RUN: nada escrito. Para aplicar: --apply`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
