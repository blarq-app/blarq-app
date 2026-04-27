/**
 * E2E test: pull EP de Lefevre, render HTML, generate PDF.
 * Run: npx tsx scripts/test-ep-pdf.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { renderEPHtml, buildEPFooter, type EPItemInput } from "../src/lib/pdf/EstadoPagoPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import { computeEPItem, type EPItemSnapshot } from "../src/lib/ep/calculations";

const prisma = new PrismaClient();

async function main() {
  const ep = await prisma.estadoPago.findFirst({
    where: { project: { name: { contains: "Lefevre" } } },
    orderBy: { number: "desc" },
    include: {
      project: { include: { maestro: true } },
      items: { orderBy: { sortOrder: "asc" } },
      budgetVersion: { select: { version: true } },
    },
  });
  if (!ep) throw new Error("No EP encontrado en Lefevre. Crear uno primero.");

  // Para test, generamos avance de prueba si no hay
  const testItems = ep.items.map((i, idx) => ({
    ...i,
    // Si todos están en 0, generar avance de prueba para visualizar la barra
    quantityExecuted: i.quantityExecuted > 0 ? i.quantityExecuted : (i.quantity * Math.min(100, (idx * 7) % 110)) / 100,
  }));

  // EPs CERRADOS anteriores
  const prevClosedEps = await prisma.estadoPago.findMany({
    where: {
      projectId: ep.projectId,
      status: "cerrado",
      number: { lt: ep.number },
    },
    orderBy: { number: "asc" },
    include: { items: true },
  });
  const prevExecMap = new Map<string, number>();
  const prevAmountMap = new Map<string, number>();
  for (const p of prevClosedEps) {
    for (const it of p.items) {
      prevExecMap.set(it.obraItemId, Math.max(prevExecMap.get(it.obraItemId) ?? 0, it.quantityExecuted));
      prevAmountMap.set(it.obraItemId, (prevAmountMap.get(it.obraItemId) ?? 0) + (it.amountPaid ?? 0));
    }
  }

  const itemsForPdf: EPItemInput[] = testItems.map((i) => {
    const snap: EPItemSnapshot = {
      quantity: i.quantity,
      laborUnitPrice: i.laborUnitPrice,
      quantityExecuted: i.quantityExecuted,
      prevExecutedQuantity: prevExecMap.get(i.obraItemId) ?? 0,
      prevAmountPaid: prevAmountMap.get(i.obraItemId) ?? 0,
      outOfScope: i.outOfScope,
    };
    const c = computeEPItem(snap);
    return {
      chapter: i.chapter,
      itemNumber: i.itemNumber,
      name: i.name,
      descriptionMaestro: i.descriptionMaestro,
      unit: i.unit,
      quantity: i.quantity,
      laborUnitPrice: i.laborUnitPrice,
      pctAccumulated: c.pctAccumulatedCurrent,
      amountThisEp: c.amountThisEp,
      totalAccumulated: c.totalAccumulated,
      outOfScope: i.outOfScope,
    };
  });

  const totalLaborBudget = testItems.reduce((s, i) => s + i.quantity * i.laborUnitPrice, 0);
  const totalAmountThisEp = itemsForPdf.reduce((s, i) => s + i.amountThisEp, 0);

  // Histórico de prueba (si no hay EPs cerrados, simulamos uno)
  const previousEps =
    prevClosedEps.length > 0
      ? prevClosedEps.map((p) => ({
          number: p.number,
          date: p.closedAt ?? p.date,
          totalPaid: p.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0),
        }))
      : [
          {
            number: 1,
            date: new Date("2026-03-15"),
            totalPaid: Math.round(totalAmountThisEp * 0.45),
          },
        ];

  const html = renderEPHtml({
    project: ep.project,
    ep: {
      number: ep.number,
      date: ep.date,
      notes: ep.notes,
      budgetVersion: ep.budgetVersion?.version ?? null,
    },
    items: itemsForPdf,
    previousEps,
    totalLaborBudget,
    totalAmountThisEp,
  });

  fs.writeFileSync("/tmp/ep-test.html", html);
  console.log(`Wrote /tmp/ep-test.html (${html.length} bytes)`);

  const pdf = await renderPDF(html, {
    format: "A4",
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: buildEPFooter(ep.number, ep.date),
    margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
  });

  fs.writeFileSync("/tmp/ep-test.pdf", pdf);
  console.log(`Wrote /tmp/ep-test.pdf (${pdf.byteLength} bytes)`);
  console.log(`\nTotales:`);
  console.log(`  Total MO presupuesto: $${totalLaborBudget.toLocaleString("es-CL")}`);
  console.log(`  Total este EP:        $${Math.round(totalAmountThisEp).toLocaleString("es-CL")}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
