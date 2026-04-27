/**
 * Migración one-shot:
 * 1. Para cada EstadoPagoItem: quantityExecuted = (pctAccumulated / 100) × quantity
 * 2. Para cada EstadoPago con status="pagado" → "cerrado", setea closedAt = updatedAt
 *    Para status="enviado" o "borrador" → quedan en "borrador"
 * 3. Para cada EstadoPago "cerrado", calcula amountPaid por item:
 *      amountPaid = (quantityExecuted - prevExecuted_in_prior_closed_eps) × laborUnitPrice
 *    Esto preserva el monto pagado histórico aunque después cambien quantity o pu.
 * 4. Asocia cada EstadoPago a la BudgetVersion de obra más reciente del proyecto.
 *
 * Run: npx tsx scripts/migrate-ep-quantity-executed.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("─── Paso 1/4: backfill quantityExecuted ───");
  const items = await prisma.estadoPagoItem.findMany({
    select: { id: true, quantity: true, pctAccumulated: true, quantityExecuted: true },
  });
  let updated1 = 0;
  for (const it of items) {
    const computed = (it.pctAccumulated / 100) * it.quantity;
    if (Math.abs(it.quantityExecuted - computed) > 0.0001) {
      await prisma.estadoPagoItem.update({
        where: { id: it.id },
        data: { quantityExecuted: computed },
      });
      updated1++;
    }
  }
  console.log(`  ✓ ${updated1} items con quantityExecuted asignado`);

  console.log("\n─── Paso 2/4: simplificar status (pagado→cerrado) ───");
  const eps = await prisma.estadoPago.findMany({
    select: { id: true, status: true, updatedAt: true, projectId: true, number: true },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
  });
  let cerrados = 0;
  let borradores = 0;
  for (const ep of eps) {
    if (ep.status === "pagado") {
      await prisma.estadoPago.update({
        where: { id: ep.id },
        data: { status: "cerrado", closedAt: ep.updatedAt },
      });
      cerrados++;
    } else if (ep.status === "enviado") {
      await prisma.estadoPago.update({
        where: { id: ep.id },
        data: { status: "borrador" },
      });
      borradores++;
    }
  }
  console.log(`  ✓ ${cerrados} EPs marcados como 'cerrado'`);
  console.log(`  ✓ ${borradores} EPs (eran 'enviado') → 'borrador'`);

  console.log("\n─── Paso 3/4: snapshot amountPaid en EPs cerrados ───");
  const epsCerrados = await prisma.estadoPago.findMany({
    where: { status: "cerrado" },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
    include: { items: true },
  });
  let amountPaidSet = 0;
  // Por proyecto, recorrer EPs en orden y armar mapa de quantityExecuted previo
  const byProject = new Map<string, typeof epsCerrados>();
  for (const ep of epsCerrados) {
    if (!byProject.has(ep.projectId)) byProject.set(ep.projectId, []);
    byProject.get(ep.projectId)!.push(ep);
  }
  for (const [, projectEps] of byProject) {
    const prevQtyByObraItem = new Map<string, number>();
    for (const ep of projectEps) {
      for (const it of ep.items) {
        const prev = prevQtyByObraItem.get(it.obraItemId) ?? 0;
        const newAmount = (it.quantityExecuted - prev) * it.laborUnitPrice;
        if (it.amountPaid === null) {
          await prisma.estadoPagoItem.update({
            where: { id: it.id },
            data: { amountPaid: newAmount },
          });
          amountPaidSet++;
        }
        prevQtyByObraItem.set(it.obraItemId, it.quantityExecuted);
      }
    }
  }
  console.log(`  ✓ ${amountPaidSet} items con amountPaid (snapshot) asignado`);

  console.log("\n─── Paso 4/4: asociar EPs a BudgetVersion vigente ───");
  const allEps = await prisma.estadoPago.findMany({
    where: { budgetVersionId: null },
    select: { id: true, projectId: true },
  });
  let assoc = 0;
  for (const ep of allEps) {
    const budget =
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra", status: "aprobado" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })) ||
      (await prisma.budgetVersion.findFirst({
        where: { projectId: ep.projectId, type: "obra" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }));
    if (budget) {
      await prisma.estadoPago.update({
        where: { id: ep.id },
        data: { budgetVersionId: budget.id },
      });
      assoc++;
    }
  }
  console.log(`  ✓ ${assoc} EPs asociados a su BudgetVersion`);

  console.log("\n✓ Migración completa");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
