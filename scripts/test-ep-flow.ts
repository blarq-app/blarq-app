/**
 * Test end-to-end del flujo del Estado de Pago en Lefevre:
 *   1. Inspecciona estado inicial
 *   2. Setea cantidades ejecutadas en EP #1
 *   3. Cierra EP #1 (vía endpoint)
 *   4. Verifica amountPaid snapshot
 *   5. Inspecciona EP #2 — debe ver el avance previo de EP #1
 *   6. Avanza más en EP #2 y valida cálculos
 *
 * Run: npx tsx scripts/test-ep-flow.ts
 */
import { PrismaClient } from "@prisma/client";
import { computeEPItem, sumEPTotals } from "../src/lib/ep/calculations";

const prisma = new PrismaClient();

function clp(n: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}

async function fetchEpFull(epId: string) {
  return prisma.estadoPago.findUnique({
    where: { id: epId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

async function buildPrevMaps(projectId: string, beforeEpNumber: number) {
  const prevClosedEps = await prisma.estadoPago.findMany({
    where: { projectId, status: "cerrado", number: { lt: beforeEpNumber } },
    include: { items: true },
  });
  const prevQty = new Map<string, number>();
  const prevPaid = new Map<string, number>();
  for (const p of prevClosedEps) {
    for (const it of p.items) {
      prevQty.set(it.obraItemId, Math.max(prevQty.get(it.obraItemId) ?? 0, it.quantityExecuted));
      prevPaid.set(it.obraItemId, (prevPaid.get(it.obraItemId) ?? 0) + (it.amountPaid ?? 0));
    }
  }
  return { prevQty, prevPaid };
}

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "Lefevre" } },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Lefevre no encontrado");

  const eps = await prisma.estadoPago.findMany({
    where: { projectId: project.id },
    orderBy: { number: "asc" },
    include: { items: true },
  });

  console.log(`\n📋 Proyecto: ${project.name}`);
  console.log(`   Tiene ${eps.length} EPs:`);
  for (const ep of eps) {
    const sum = ep.items.reduce((s, i) => s + i.quantityExecuted, 0);
    console.log(`   - EP #${ep.number} (${ep.status}) — ${ep.items.length} items — qty total: ${sum}`);
  }

  if (eps.length < 1) {
    throw new Error("Necesito al menos EP #1. Corré reset-ep-lefevre.ts primero.");
  }

  const ep1 = eps[0];
  // ep2 lo creamos después del cierre de ep1
  let ep2: typeof ep1 | null = eps[1] ?? null;

  // ── PASO 1: setear quantityExecuted en EP #1 (simula UI editando %) ──
  console.log(`\n${"─".repeat(70)}`);
  console.log(`PASO 1 — Editar EP #${ep1.number} (simulación de UI)`);
  console.log(`${"─".repeat(70)}`);

  if (ep1.status === "cerrado") {
    console.log(`✓ EP #${ep1.number} ya está cerrado, salto edición.`);
  } else {
    // Para 5 partidas, asignar % distintos (100, 100, 80, 50, 30)
    const targetPcts = [100, 100, 80, 50, 30];
    const itemsToEdit = ep1.items.slice(0, targetPcts.length);
    for (let i = 0; i < itemsToEdit.length; i++) {
      const item = itemsToEdit[i];
      const pct = targetPcts[i];
      const newQty = (pct / 100) * item.quantity;
      await prisma.estadoPagoItem.update({
        where: { id: item.id },
        data: { quantityExecuted: newQty, pctAccumulated: pct },
      });
      const totalLine = newQty * item.laborUnitPrice;
      console.log(
        `   ${item.itemNumber} ${item.name.padEnd(35)} → ${pct}% (${newQty.toFixed(1)} ${item.unit}) = ${clp(totalLine)}`
      );
    }
  }

  // ── PASO 2: cerrar EP #1 ──
  console.log(`\n${"─".repeat(70)}`);
  console.log(`PASO 2 — Cerrar EP #${ep1.number} (snapshot amountPaid)`);
  console.log(`${"─".repeat(70)}`);

  if (ep1.status !== "cerrado") {
    // Replica la lógica del endpoint /close — directo vía Prisma para no depender del server
    const ep1Items = await prisma.estadoPagoItem.findMany({
      where: { estadoPagoId: ep1.id },
    });
    const prevClosed = await prisma.estadoPago.findMany({
      where: {
        projectId: project.id,
        status: "cerrado",
        number: { lt: ep1.number },
      },
      include: { items: true },
    });
    const prevQtyMap = new Map<string, number>();
    for (const p of prevClosed) {
      for (const it of p.items) {
        prevQtyMap.set(
          it.obraItemId,
          Math.max(prevQtyMap.get(it.obraItemId) ?? 0, it.quantityExecuted)
        );
      }
    }
    await prisma.$transaction([
      ...ep1Items.map((it) => {
        const prevQ = prevQtyMap.get(it.obraItemId) ?? 0;
        const newQ = Math.max(0, it.quantityExecuted - prevQ);
        return prisma.estadoPagoItem.update({
          where: { id: it.id },
          data: { amountPaid: newQ * it.laborUnitPrice },
        });
      }),
      prisma.estadoPago.update({
        where: { id: ep1.id },
        data: { status: "cerrado", closedAt: new Date() },
      }),
    ]);
    console.log(`   ✓ EP #${ep1.number} cerrado (vía Prisma directo)`);
  } else {
    console.log(`   (ya estaba cerrado)`);
  }

  // Re-fetch para ver amountPaid
  const ep1After = await fetchEpFull(ep1.id);
  if (!ep1After) throw new Error("No se pudo releer EP1");
  let totalPaidEp1 = 0;
  console.log(`\n   Snapshot amountPaid de EP #${ep1.number}:`);
  for (const it of ep1After.items.slice(0, 5)) {
    totalPaidEp1 += it.amountPaid ?? 0;
    if ((it.amountPaid ?? 0) > 0) {
      console.log(
        `   ${it.itemNumber} ${it.name.slice(0, 30).padEnd(30)} amountPaid = ${clp(it.amountPaid ?? 0)}`
      );
    }
  }
  totalPaidEp1 = ep1After.items.reduce((s, it) => s + (it.amountPaid ?? 0), 0);
  console.log(`   ── Total pagado en EP #${ep1.number}: ${clp(totalPaidEp1)}`);

  // ── PASO 2.5: crear EP #2 si no existe ──
  if (!ep2) {
    console.log(`\n   (Creando EP #2 fresh tras cierre de EP #1)`);
    const budget = await prisma.budgetVersion.findFirst({
      where: { projectId: project.id, type: "obra" },
      orderBy: { createdAt: "desc" },
      include: { obraItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (!budget) throw new Error("No hay BudgetVersion vigente");

    // prevQty desde EP #1 ya cerrado
    const prevClosed = await prisma.estadoPago.findMany({
      where: { projectId: project.id, status: "cerrado" },
      include: { items: true },
    });
    const prevQtyMap = new Map<string, number>();
    for (const p of prevClosed) {
      for (const it of p.items) {
        prevQtyMap.set(
          it.obraItemId,
          Math.max(prevQtyMap.get(it.obraItemId) ?? 0, it.quantityExecuted)
        );
      }
    }

    const created = await prisma.estadoPago.create({
      data: {
        projectId: project.id,
        budgetVersionId: budget.id,
        number: 2,
        items: {
          create: budget.obraItems.map((item, idx) => {
            const lpu = item.costLabor ?? 0;
            const prevQ = prevQtyMap.get(item.id) ?? 0;
            return {
              obraItemId: item.id,
              chapter: item.chapter,
              itemNumber: item.itemNumber,
              name: item.name,
              descriptionMaestro: item.descriptionMaestro,
              unit: item.unit,
              quantity: item.quantity,
              laborUnitPrice: lpu,
              laborTotal: lpu * item.quantity,
              quantityExecuted: prevQ, // ← arranca con avance heredado
              pctAccumulated: item.quantity > 0 ? (prevQ / item.quantity) * 100 : 0,
              sortOrder: item.sortOrder ?? idx,
            };
          }),
        },
      },
      include: { items: true },
    });
    ep2 = created;
    console.log(`   ✓ EP #2 creado con avance heredado pre-cargado`);
  }

  // ── PASO 3: inspeccionar EP #2 con avance previo ──
  console.log(`\n${"─".repeat(70)}`);
  console.log(`PASO 3 — EP #${ep2.number} (vista con avance previo de EP #1)`);
  console.log(`${"─".repeat(70)}`);

  const { prevQty, prevPaid } = await buildPrevMaps(project.id, ep2.number);
  console.log(`   Partidas con avance previo heredado de EP #${ep1.number}: ${prevQty.size}\n`);

  const ep2Refresh = await fetchEpFull(ep2.id);
  if (!ep2Refresh) throw new Error("No se pudo releer EP2");

  // Mostrar lo que se vería en la UI para 5 partidas
  for (const it of ep2Refresh.items.slice(0, 5)) {
    const prev = prevQty.get(it.obraItemId) ?? 0;
    const prevPaidVal = prevPaid.get(it.obraItemId) ?? 0;
    const c = computeEPItem({
      quantity: it.quantity,
      laborUnitPrice: it.laborUnitPrice,
      quantityExecuted: it.quantityExecuted,
      prevExecutedQuantity: prev,
      prevAmountPaid: prevPaidVal,
    });
    console.log(
      `   ${it.itemNumber} ${it.name.slice(0, 30).padEnd(30)} ` +
        `prev=${prev.toFixed(1)} (${c.pctAccumulatedPrev.toFixed(0)}%) · ` +
        `actual=${it.quantityExecuted.toFixed(1)} (${c.pctAccumulatedCurrent.toFixed(0)}%) · ` +
        `a pagar este EP: ${clp(c.amountThisEp)}`
    );
  }

  // ── PASO 4: avanzar más en EP #2 ──
  console.log(`\n${"─".repeat(70)}`);
  console.log(`PASO 4 — Avanzar 2 partidas en EP #${ep2.number}`);
  console.log(`${"─".repeat(70)}`);

  // Tomar las primeras 2 con avance parcial (entre 1% y 80%) para que puedan crecer
  const candidates = ep2Refresh.items
    .filter((it) => {
      const prev = prevQty.get(it.obraItemId) ?? 0;
      const pct = it.quantity > 0 ? (prev / it.quantity) * 100 : 0;
      return pct > 0 && pct < 80;
    })
    .slice(0, 2);
  for (const it of candidates) {
    const prev = prevQty.get(it.obraItemId) ?? 0;
    const prevPct = (prev / it.quantity) * 100;
    const newPct = Math.min(100, prevPct + 20);
    const newQty = (newPct / 100) * it.quantity;
    await prisma.estadoPagoItem.update({
      where: { id: it.id },
      data: { quantityExecuted: newQty, pctAccumulated: newPct },
    });
    const c = computeEPItem({
      quantity: it.quantity,
      laborUnitPrice: it.laborUnitPrice,
      quantityExecuted: newQty,
      prevExecutedQuantity: prev,
      prevAmountPaid: prevPaid.get(it.obraItemId) ?? 0,
    });
    console.log(
      `   ${it.itemNumber} ${it.name.slice(0, 30).padEnd(30)} ` +
        `${prevPct.toFixed(0)}% → ${newPct.toFixed(0)}% (delta ${(newPct - prevPct).toFixed(0)}%) ` +
        `→ a pagar: ${clp(c.amountThisEp)}`
    );
  }

  // ── PASO 5: totales del EP #2 ──
  console.log(`\n${"─".repeat(70)}`);
  console.log(`PASO 5 — Totales finales de EP #${ep2.number}`);
  console.log(`${"─".repeat(70)}`);

  const ep2Final = await fetchEpFull(ep2.id);
  if (!ep2Final) throw new Error("No se pudo releer EP2 final");
  const snaps = ep2Final.items.map((it) => ({
    quantity: it.quantity,
    laborUnitPrice: it.laborUnitPrice,
    quantityExecuted: it.quantityExecuted,
    prevExecutedQuantity: prevQty.get(it.obraItemId) ?? 0,
    prevAmountPaid: prevPaid.get(it.obraItemId) ?? 0,
    outOfScope: it.outOfScope,
  }));
  const totals = sumEPTotals(snaps);
  console.log(`   Total MO presupuestado:        ${clp(totals.totalMoBudget)}`);
  console.log(`   Pagado en EPs anteriores:      ${clp(totals.totalAmountAccumulatedPrev)}`);
  console.log(`   A pagar este EP #${ep2.number}:           ${clp(totals.totalAmountThisEp)}`);
  console.log(`   Total acumulado (post-cierre): ${clp(totals.totalAmountAccumulatedAfterThisEp)}`);
  console.log(`   Saldo por pagar:               ${clp(totals.saldoPorPagar)}`);

  // Sanity check: total pagado en EP1 = totalAmountAccumulatedPrev de EP2
  const matches = Math.abs(totalPaidEp1 - totals.totalAmountAccumulatedPrev) < 1;
  console.log(
    `\n   ${matches ? "✓" : "✗"} Sanity check: total pagado EP#1 (${clp(totalPaidEp1)}) = acumulado previo en EP#2 (${clp(totals.totalAmountAccumulatedPrev)})`
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
