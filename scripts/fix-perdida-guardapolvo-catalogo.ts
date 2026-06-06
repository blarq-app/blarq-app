import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcPartidaTotals } from "../src/lib/catalog/recalcPartida";
import { writeFileSync } from "fs";

/**
 * Materializa la PÉRDIDA fantasma de la partida de catálogo "INSTALACION
 * GUARDAPOLVO PORCELANATO": hoy existe como monto suelto arriba (costLoss
 * lump = $1.260,5) pero NO como línea del desglose. Esto agrega la línea de
 * pérdida como "% sobre el porcelanato", dejando el total IDÉNTICO.
 *
 * El % NO se inventa: se deriva del propio monto actual
 *   pct = costLoss_lump / total_del_porcelanato * 100
 * así la línea nueva vale exactamente lo que ya estaba arriba y el P.U. no se
 * mueve ni un peso.
 *
 * Dry-run por DEFECTO. Para aplicar a prod: --apply (y con OK explícito de MJ).
 * Idempotente: si ya hay una línea de pérdida, no hace nada.
 *
 * Uso:
 *   dry-run dev :  npx tsx scripts/fix-perdida-guardapolvo-catalogo.ts
 *   dry-run prod:  DATABASE_URL=<prod> npx tsx scripts/fix-perdida-guardapolvo-catalogo.ts
 *   aplicar prod:  DATABASE_URL=<prod> npx tsx scripts/fix-perdida-guardapolvo-catalogo.ts --apply
 */

const APPLY = process.argv.includes("--apply");
const PARTIDA_ID = "cmnxpmxgd01aertykz22bbe5d";
const NAME_GUARD = "GUARDAPOLVO PORCELANATO";

function host() {
  const m = (process.env.DATABASE_URL || "").match(/@([^/.]+)/);
  return m ? m[1] : "desconocido";
}
function r2(n: number) {
  return Math.round(n * 100) / 100;
}

async function main() {
  console.log(`Host: ${host()}  —  modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}\n`);

  const partida = await prisma.partidaCatalog.findUnique({ where: { id: PARTIDA_ID } });
  if (!partida) throw new Error("No se encontró la partida del catálogo");
  if (!partida.name.toUpperCase().includes(NAME_GUARD)) {
    throw new Error(`Guardia de nombre falló: la partida es "${partida.name}", no la esperada`);
  }
  const comps = await prisma.partidaComponent.findMany({
    where: { partidaId: PARTIDA_ID },
    orderBy: { sortOrder: "asc" },
  });

  console.log(`Partida: ${partida.name}`);
  console.log(`  ANTES → costLoss lump = ${r2(partida.costLoss)} | P.U. = ${r2(partida.unitPrice)} | líneas = ${comps.length}`);

  // Guardas.
  const yaPerdida = comps.find((c) => c.type === "perdida");
  if (yaPerdida) {
    console.log("\nYa existe una línea de pérdida en el desglose → nada que hacer (idempotente).");
    return;
  }
  if (!partida.costLoss || partida.costLoss <= 0) {
    console.log("\nNo hay costLoss lump > 0 → nada que materializar.");
    return;
  }
  // Material sobre el que aplica la pérdida: el porcelanato (provisión pavimento).
  const porcelanato =
    comps.find((c) => c.type === "material" && /PORCELANATO/i.test(c.description)) ??
    comps.filter((c) => c.type === "material").sort((a, b) => b.totalCost - a.totalCost)[0];
  if (!porcelanato) throw new Error("No se encontró el material porcelanato para aplicar la pérdida");

  const base = porcelanato.totalCost;
  const pct = derivePct(base, partida.costLoss);
  const lineaTotal = base * (pct / 100);

  console.log(`\n  Material destino: "${porcelanato.description}" (total ${r2(base)})`);
  console.log(`  % derivado del monto actual: ${r2(pct)}%  →  línea de pérdida = ${r2(lineaTotal)}`);
  console.log(`  (chequeo: ${r2(lineaTotal)} vs costLoss lump ${r2(partida.costLoss)} → ${Math.abs(lineaTotal - partida.costLoss) < 0.5 ? "OK, calza" : "⚠ NO calza"})`);

  // Simular el resultado final (recalc desde componentes + la nueva línea).
  const puComponentes = comps.reduce((s, c) => s + c.totalCost, 0); // sin pérdida
  const puFinal = puComponentes + lineaTotal;
  console.log(`\n  DESPUÉS (simulado) → costLoss = ${r2(lineaTotal)} | P.U. = ${r2(puFinal)}`);
  console.log(`  Δ P.U. = ${r2(puFinal - partida.unitPrice)} (debe ser ~0)`);

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada. Para aplicar: agregá --apply (con OK de MJ).");
    return;
  }

  // Backup antes de escribir.
  const stamp = (process.env.STAMP || "manual");
  const backupPath = `/Users/mjblanco/Desktop/blarq-app/backups/fix-perdida-guardapolvo-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ partida, comps }, null, 2));
  console.log(`\nBackup escrito: ${backupPath}`);

  // Crear la línea de pérdida.
  await prisma.partidaComponent.create({
    data: {
      partidaId: PARTIDA_ID,
      type: "perdida",
      description: "Pérdida porcelanato",
      unit: "%",
      quantity: r2(pct),
      unitCost: 0,
      totalCost: lineaTotal,
      appliedToComponentId: porcelanato.id,
      sortOrder: comps.length,
    },
  });
  // Recalcular totales del catálogo desde el desglose (ahora con la pérdida).
  const result = await recalcPartidaTotals(PARTIDA_ID);
  console.log(`\nAPLICADO → costLoss = ${r2(result.costLoss)} | P.U. = ${r2(result.unitPrice)}`);
  const partidaPost = await prisma.partidaCatalog.findUniqueOrThrow({ where: { id: PARTIDA_ID } });
  console.log(`  Δ P.U. real = ${r2(partidaPost.unitPrice - partida.unitPrice)} (debe ser ~0)`);
}

// % tal que base*%/100 = lump  →  % = lump/base*100
function derivePct(base: number, lump: number) {
  if (base <= 0) return 0;
  return (lump / base) * 100;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
