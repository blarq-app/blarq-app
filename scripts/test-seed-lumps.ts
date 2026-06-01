import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  seedObraItemComponentsFromLumps,
  recalcObraItemFromComponents,
} from "../src/lib/catalog/recalcObraItem";

/**
 * Regresión del "seguro anti-borrado" (§4.1/§4.2): al detallar materiales de
 * una partida cargada con montos globales, la mano de obra / margen NO se
 * pierden y el total queda idéntico.
 *
 * Crea data de prueba propia y la borra al final (try/finally). Corre contra
 * la BD que apunte DATABASE_URL (usar dev).
 */

let projectId = "";
let itemId = "";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  const project = await prisma.project.create({
    data: { name: "__TEST seed-lumps", clientName: "__TEST" },
  });
  projectId = project.id;
  const bv = await prisma.budgetVersion.create({
    data: { projectId, version: "V1", type: "obra", status: "borrador" },
  });
  // Partida espejo del screenshot: MO 2.500 + Margen 1.250, sin materiales,
  // sin componentes. P.U. = suma = 3.750; qty 10 → total 37.500.
  const item = await prisma.obraItem.create({
    data: {
      budgetVersionId: bv.id,
      chapter: "demoliciones",
      itemNumber: "1.1",
      name: "DEMOLICION CIELO FALSO",
      unit: "M2",
      quantity: 10,
      unitPrice: 3750,
      total: 37500,
      costMaterial: 0,
      costLabor: 2500,
      costMargin: 1250,
    },
  });
  itemId = item.id;

  console.log("Test A — sembrar montos globales NO mueve el total:");
  const seeded = await seedObraItemComponentsFromLumps(itemId);
  assert(seeded === true, "sembró (había montos no-cero)");
  await recalcObraItemFromComponents(itemId);
  let r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  const comps = await prisma.obraItemComponent.findMany({
    where: { obraItemId: itemId },
  });
  assert(comps.length === 2, "sembró 2 líneas (MO fija + Margen %, material $0 omitido)");
  const margenComp = comps.find((c) => c.type === "margen");
  assert(margenComp?.unit === "%", "margen sembrado como % (no monto fijo)");
  assert(Math.abs((margenComp?.quantity ?? 0) - 50) < 0.01, "margen = 50% (1.250/2.500)");
  assert(r.costLabor === 2500, "mano de obra se conserva ($2.500)");
  assert(r.costMargin === 1250, "margen al sembrar sigue $1.250 (base sin cambio)");
  assert(r.unitPrice === 3750, "P.U. sigue $3.750");
  assert(r.total === 37500, "total sigue $37.500 (no se movió)");

  console.log("Test B — agregar un material conserva MO/margen:");
  // Re-siembra es idempotente (no debe duplicar).
  const reseed = await seedObraItemComponentsFromLumps(itemId);
  assert(reseed === false, "re-sembrar no hace nada (idempotente)");
  // Simula "agregar material": 2 un × $5.000 = $10.000.
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: itemId,
      type: "material",
      description: "CERÁMICA 30x30",
      unit: "UN",
      quantity: 2,
      unitCost: 5000,
      totalCost: 10000,
      isCustomized: true,
      sortOrder: 2,
    },
  });
  await recalcObraItemFromComponents(itemId);
  r = await prisma.obraItem.findUniqueOrThrow({ where: { id: itemId } });
  assert(r.costLabor === 2500, "mano de obra INTACTA tras agregar material ($2.500)");
  assert(r.costMaterial === 10000, "material ahora $10.000 (la línea nueva)");
  // El margen es 50% del costo directo: ahora base = 2.500 (MO) + 10.000 (mat)
  // = 12.500 → margen = $6.250. CRECIÓ con los materiales (pedido de MJ).
  assert(r.costMargin === 6250, "margen CRECIÓ a $6.250 (50% de 2.500+10.000)");
  assert(r.unitPrice === 18750, "P.U. = 2.500+10.000+6.250 = 18.750");
  assert(r.total === 187500, "total = 18.750 × 10 = 187.500");

  console.log("\nTODO OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Limpieza: borra la data de prueba (orden por FKs).
    if (itemId) {
      await prisma.obraItemComponent.deleteMany({ where: { obraItemId: itemId } });
    }
    if (projectId) {
      await prisma.obraItem.deleteMany({
        where: { budgetVersion: { projectId } },
      });
      await prisma.budgetVersion.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.$disconnect();
  });
