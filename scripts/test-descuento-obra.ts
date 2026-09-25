// Regresión sin base de datos: descuento, cobros, costos y cuadro del cliente.
// Ejecutar con: node --import tsx scripts/test-descuento-obra.ts
import assert from "node:assert/strict";
import {
  computeObraBudgetTotals, computeProjectMetrics, validateObraDiscount,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";
import { computeCuadroResumen, type CuadroResumenInput } from "../src/lib/projects/cuadroResumen";

const date = new Date("2026-01-01");
const obra = {
  id: "obra", version: "V1", type: "obra", status: "aprobado", createdAt: date, updatedAt: date,
  ggPercentage: 20, utilityPercentage: 5, discountAmount: 0,
  obraItems: [{ total: 1_000_000, quantity: 1, costLabor: 300_000, costMaterial: 700_000 },
    { total: 100_000, quantity: 1, costLabor: 100_000, noCobrado: true }],
  muebleChapters: [], artefactoItems: [],
};
const furniture = { ...obra, id: "muebles", type: "muebles", obraItems: [],
  muebleChapters: [{ items: [{ quantity: 1, clientPriceNet: 500_000, clientPriceIva: 595_000,
    costDistributor: 300_000, alternativeOfId: null }] }],
};
const appliances = { ...obra, id: "artefactos", type: "artefactos", obraItems: [],
  artefactoItems: [{ subcategory: "cocina", clientPrice: 119_000, quantity: 1 }],
};
const invoices = [
  { type: "emitida", tipoDoc: 33, totalAmount: 595_000, netAmount: 500_000,
    status: "pagada", category: { name: "Obra" }, conceptoCobro: "obra", issueDate: date,
    payments: [{ amountApplied: 595_000, bankMovement: { date } }] },
  { type: "recibida", tipoDoc: 33, totalAmount: 238_000, netAmount: 200_000, status: "pagada", category: null },
  { type: "recibida", tipoDoc: 61, totalAmount: 23_800, netAmount: 20_000, status: "pagada", category: null },
];
function project(discountAmount: number) {
  return { budgetVersions: [{ ...obra, discountAmount }, furniture, appliances], invoices,
    estadosPago: [], isInternal: false } as unknown as ProjectWithMetrics;
}
const original = computeObraBudgetTotals(obra);
assert.equal(original.totalOriginal, 1_487_500);
assert.equal(original.totalFinal, 1_487_500);
assert.equal(original.costoDirecto, 1_000_000);
const discounted = computeObraBudgetTotals({ ...obra, discountAmount: 87_500 });
assert.equal(discounted.totalFinal, 1_400_000);
assert.equal(discounted.netoFinal, 1_400_000 / 1.19);
assert.equal(discounted.costoDirecto, original.costoDirecto);
assert.equal(discounted.gastosGenerales, original.gastosGenerales);
assert.equal(computeObraBudgetTotals({ ...obra, discountAmount: 1_487_500 }).totalFinal, 0);
assert.equal(computeObraBudgetTotals({ ...obra, discountAmount: 9_000_000 }).totalFinal, 0);
assert.equal(computeObraBudgetTotals({ ...obra, discountAmount: null }).totalFinal, original.totalFinal);
assert.equal(computeObraBudgetTotals({ ...obra, ggPercentage: 0, utilityPercentage: 0 }).totalFinal, 1_190_000);
for (const invalid of [-1, 0.5, NaN, Infinity, "100", null, 1_487_501]) {
  assert.ok(validateObraDiscount(invalid, original.totalOriginal));
}
for (const valid of [0, 87_500, 1_487_500]) assert.equal(validateObraDiscount(valid, original.totalOriginal), null);
const before = computeProjectMetrics(project(0));
const after = computeProjectMetrics(project(87_500));
assert.equal(after.totalAcordado, before.totalAcordado - 87_500);
assert.equal(after.totalCobrado, before.totalCobrado);
assert.equal(after.totalCobradoNeto, before.totalCobradoNeto);
assert.equal(after.totalGastado, before.totalGastado);
assert.equal(after.utilidadReal, before.utilidadReal);
assert.deepEqual(after.budgetByType, before.budgetByType);
assert.deepEqual(after.budgetBySubcategory, before.budgetBySubcategory);
assert.ok(Math.abs(after.utilidadProyectada - (before.utilidadProyectada - 87_500 / 1.19)) < 0.001);
const cuadro = computeCuadroResumen({ budgets: project(87_500).budgetVersions, invoices } as unknown as CuadroResumenInput);
assert.equal(cuadro.conceptos.find(c => c.key === "obra")?.acordado, 1_400_000);
assert.equal(cuadro.conceptos.find(c => c.key === "obra")?.saldo, 805_000);
assert.equal(cuadro.conceptos.find(c => c.key === "muebles")?.acordado, 595_000);
assert.equal(cuadro.totalAcordado, after.totalAcordado);
const free = computeCuadroResumen({ budgets: project(1_487_500).budgetVersions, invoices } as unknown as CuadroResumenInput);
assert.equal(free.conceptos.find(c => c.key === "obra")?.acordado, 0);
assert.equal(free.conceptos.find(c => c.key === "obra")?.pagado, 595_000);
assert.equal(free.conceptos.find(c => c.key === "obra")?.saldo, -595_000);
assert.equal(free.totalPagado, cuadro.totalPagado);
assert.deepEqual(computeProjectMetrics(project(0)), before);
console.log("Descuento de obra: total, saldo, neto, validación y aislamiento de costos/pagos correctos.");
