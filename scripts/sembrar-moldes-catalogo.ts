import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recalcPartidaTotals } from "../src/lib/catalog/recalcPartida";
import { writeFileSync } from "fs";

/**
 * Siembra el desglose de los moldes del catálogo (PartidaCatalog) que hoy NO
 * tienen componentes — para cumplir la regla MJ: toda partida tiene desglose.
 *
 * Mismo criterio que el Paso 1 en cotizaciones: los costos directos (material,
 * MO, herramientas, subcontrato, pérdida) se siembran como MONTO FIJO; el margen
 * como % del costo directo. El total (unitPrice) queda IDÉNTICO.
 *
 * Solo afecta cotizaciones FUTURAS (por la regla 3, el catálogo no propaga solo
 * a las cotizaciones que ya existen). Dry-run por defecto; --apply para escribir.
 * Backup previo. Idempotente (solo toca moldes sin componentes). Aborta si algún
 * unitPrice se movería.
 */

const APPLY = process.argv.includes("--apply");
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
function host() {
  return (process.env.DATABASE_URL || "").match(/ep-[a-z-]+/)?.[0] ?? "?";
}

type Row = {
  type: string; description: string; unit: string;
  quantity: number; unitCost: number; totalCost: number; sortOrder: number;
};

function buildSeedRows(item: {
  costMaterial: number | null; costLabor: number | null; costTools: number | null;
  costSubcontract: number | null; costLoss: number | null; costMargin: number | null;
}): Row[] {
  const fixed: Array<{ type: string; amount: number; label: string }> = [
    { type: "material", amount: item.costMaterial ?? 0, label: "Materiales (monto original)" },
    { type: "mano_obra", amount: item.costLabor ?? 0, label: "Mano de obra (monto original)" },
    { type: "herramientas", amount: item.costTools ?? 0, label: "Herramientas (monto original)" },
    { type: "subcontrato", amount: item.costSubcontract ?? 0, label: "Subcontrato (monto original)" },
    { type: "perdida", amount: item.costLoss ?? 0, label: "Pérdida (monto original)" },
  ].filter((l) => l.amount && l.amount !== 0);

  const rows: Row[] = fixed.map((l, i) => ({
    type: l.type, description: l.label, unit: "GL",
    quantity: 1, unitCost: l.amount, totalCost: l.amount, sortOrder: i,
  }));

  const margin = item.costMargin ?? 0;
  const marginBase =
    (item.costMaterial ?? 0) + (item.costLabor ?? 0) +
    (item.costTools ?? 0) + (item.costSubcontract ?? 0);
  if (margin !== 0) {
    if (marginBase > 0) {
      rows.push({
        type: "margen", description: "Margen (% original)", unit: "%",
        quantity: (margin / marginBase) * 100, unitCost: 0, totalCost: margin, sortOrder: rows.length,
      });
    } else {
      rows.push({
        type: "margen", description: "Margen (monto original)", unit: "GL",
        quantity: 1, unitCost: margin, totalCost: margin, sortOrder: rows.length,
      });
    }
  }
  return rows;
}

async function main() {
  console.log(`Host: ${host()}  —  modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN"}\n`);

  const moldes = await prisma.partidaCatalog.findMany({
    where: { components: { none: {} } },
    select: {
      id: true, category: true, name: true, unitPrice: true,
      costMaterial: true, costLabor: true, costTools: true,
      costSubcontract: true, costLoss: true, costMargin: true,
    },
  });
  console.log(`${moldes.length} moldes sin desglose.\n`);

  if (APPLY) {
    const stamp = process.env.STAMP || "manual";
    const path = `/Users/mjblanco/Desktop/blarq-app/backups/sembrar-moldes-catalogo-${stamp}.json`;
    writeFileSync(path, JSON.stringify(moldes, null, 2));
    console.log(`Backup: ${path}\n`);
  }

  let cambios = 0;
  for (const m of moldes) {
    const rows = buildSeedRows(m);
    const sumSeed = rows.reduce((s, r) => s + r.totalCost, 0);
    const diff = sumSeed - (m.unitPrice ?? 0);
    const flag = Math.abs(diff) > 1 ? "  ⚠ MOVERÍA EL PRECIO" : "";
    console.log(`${rows.length ? "  " : "··"} ${m.name}: P.U. ${clp(m.unitPrice ?? 0)} → desglose ${clp(sumSeed)} (${rows.length} líneas)${flag}`);
    if (Math.abs(diff) > 1) {
      cambios++;
      if (APPLY) { console.log("    SALTADO por seguridad (no cuadra)."); continue; }
    }
    if (!rows.length) continue;

    if (APPLY) {
      await prisma.partidaComponent.createMany({
        data: rows.map((r) => ({ partidaId: m.id, ...r })),
      });
      const res = await recalcPartidaTotals(m.id);
      if (Math.abs((res.unitPrice ?? 0) - (m.unitPrice ?? 0)) > 1) {
        console.log(`    ⚠ POST: unitPrice cambió a ${clp(res.unitPrice)} (era ${clp(m.unitPrice ?? 0)})`);
      }
    }
  }

  if (cambios) console.log(`\n⚠ ${cambios} molde(s) NO cuadraban (Σcost ≠ P.U.) y se saltaron — revisar a mano.`);
  if (!APPLY) console.log("\nDRY-RUN: no se escribió nada. Para aplicar: --apply (con OK de MJ).");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
