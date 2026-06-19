import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Snapshot de control (CLAUDE.md §4.1) para el cambio de propagación de
 * precios de artefactos catálogo↔cotización.
 *
 * Imprime, por cada versión de presupuesto de tipo "artefactos", los totales
 * que el cambio PODRÍA mover:
 *   - total cliente   = Σ clientPrice × quantity
 *   - total costo     = Σ realCostBlarq × quantity
 *
 * Se corre ANTES y DESPUÉS del cambio sobre la MISMA base. Como el cambio solo
 * agrega una columna con default (priceOverridden) y cambia comportamiento a
 * futuro (la propagación recién corre cuando MJ edita el catálogo), los totales
 * deben quedar IDÉNTICOS. Cualquier diferencia es una alarma.
 *
 * Uso:
 *   npx tsx scripts/snapshot-artefactos-totales.ts > /tmp/snap-artefactos-ANTES.txt
 *   ...aplicar cambios...
 *   npx tsx scripts/snapshot-artefactos-totales.ts > /tmp/snap-artefactos-DESPUES.txt
 *   diff /tmp/snap-artefactos-ANTES.txt /tmp/snap-artefactos-DESPUES.txt
 */
async function main() {
  const versiones = await prisma.budgetVersion.findMany({
    where: { type: "artefactos" },
    include: {
      project: { select: { name: true } },
      artefactoItems: {
        select: { clientPrice: true, realCostBlarq: true, quantity: true },
      },
    },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }],
  });

  let granTotalCliente = 0;
  let granTotalCosto = 0;

  for (const v of versiones) {
    const totalCliente = v.artefactoItems.reduce(
      (s, i) => s + i.clientPrice * i.quantity,
      0
    );
    const totalCosto = v.artefactoItems.reduce(
      (s, i) => s + (i.realCostBlarq ?? 0) * i.quantity,
      0
    );
    granTotalCliente += totalCliente;
    granTotalCosto += totalCosto;

    // Una línea por versión, formato estable para diff.
    console.log(
      [
        v.project.name.padEnd(34).slice(0, 34),
        v.version.padEnd(10).slice(0, 10),
        v.status.padEnd(10).slice(0, 10),
        `items=${String(v.artefactoItems.length).padStart(3)}`,
        `cliente=${Math.round(totalCliente).toString().padStart(12)}`,
        `costo=${Math.round(totalCosto).toString().padStart(12)}`,
      ].join("  ")
    );
  }

  console.log("─".repeat(110));
  console.log(
    `TOTAL  versiones=${versiones.length}  ` +
      `cliente=${Math.round(granTotalCliente)}  ` +
      `costo=${Math.round(granTotalCosto)}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
