/**
 * Tests de la lógica pura de cálculo de EP. Cubre los 4 casos de la
 * autorevisión del spec.
 *
 * Run: npx tsx scripts/test-ep-calculations.ts
 */
import {
  computeEPItem,
  validateQuantityExecuted,
  pctToQuantity,
  sumEPTotals,
} from "../src/lib/ep/calculations";

let passed = 0;
let failed = 0;

function eq(label: string, actual: number, expected: number, tol = 0.001) {
  if (Math.abs(actual - expected) <= tol) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: esperado ${expected}, obtuve ${actual}`);
    failed++;
  }
}
function eqStr(label: string, actual: string | null, expected: string | RegExp | null) {
  const ok =
    expected === null
      ? actual === null
      : typeof expected === "string"
        ? actual === expected
        : actual !== null && expected.test(actual);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: esperado ${String(expected)}, obtuve ${String(actual)}`);
    failed++;
  }
}

// ============================================================================
console.log("\n📋 Caso 1 — Avance simple");
console.log("EP1 cerrado con 30 m² ejecutados sobre 100 m² (30%, $150.000 a $5.000/m²)");
console.log("EP2 (borrador) edito cantidad ejecutada a 50 m²");
{
  const c = computeEPItem({
    quantity: 100,
    laborUnitPrice: 5000,
    quantityExecuted: 50,
    prevExecutedQuantity: 30,
    prevAmountPaid: 150000,
  });
  eq("totalMo", c.totalMo, 500000);
  eq("pctAccumulatedPrev", c.pctAccumulatedPrev, 30);
  eq("pctAccumulatedCurrent", c.pctAccumulatedCurrent, 50);
  eq("newQuantityThisEp", c.newQuantityThisEp, 20);
  eq("amountThisEp (20 × $5.000)", c.amountThisEp, 100000);
  eq("totalAccumulated (150k + 100k)", c.totalAccumulated, 250000);
}

// ============================================================================
console.log("\n📋 Caso 2 — Intento de retroceso");
console.log("EP1 cerrado con 30 m². EP2 intento poner 20 m²");
{
  const err = validateQuantityExecuted(20, {
    prevExecutedQuantity: 30,
    quantity: 100,
  });
  eqStr("validación bloquea (mensaje contiene 'EP anterior')", err, /EP anterior/);
}

// ============================================================================
console.log("\n📋 Caso 2b — Intento de exceder el total");
console.log("Total presupuesto 100 m². Intento poner 150 m²");
{
  const err = validateQuantityExecuted(150, {
    prevExecutedQuantity: 30,
    quantity: 100,
  });
  eqStr("validación bloquea (mensaje contiene 'presupuestada')", err, /presupuestada/);
}

// ============================================================================
console.log("\n📋 Caso 3 — Cambio de versión: aumento de cantidad_total");
console.log("V1: 200 m² × $5.000. EP1 cerrado con 120 m² ($600.000)");
console.log("V2: 250 m² × $5.000. Sync EP2.");
console.log("→ cant_anterior=120, % anterior pasa de 60% a 48%, monto pagado intacto");
{
  // Pre-sync (V1): 60%
  const pre = computeEPItem({
    quantity: 200,
    laborUnitPrice: 5000,
    quantityExecuted: 120, // representa el momento justo después del cierre del EP1
    prevExecutedQuantity: 120, // si fuera el inicio del EP2, prev = 120
    prevAmountPaid: 600000,
  });
  eq("pre-sync %", pre.pctAccumulatedCurrent, 60);

  // Post-sync (V2): mismo cant_ejec_anterior=120, pero cant_total ahora es 250
  // En el EP2 (borrador), edito cant_ejec a 150 (avance nuevo de 30 m²)
  const post = computeEPItem({
    quantity: 250, // ← V2
    laborUnitPrice: 5000,
    quantityExecuted: 150,
    prevExecutedQuantity: 120,
    prevAmountPaid: 600000, // ← intacto
  });
  eq("post-sync pctAccumulatedPrev (120/250)", post.pctAccumulatedPrev, 48);
  eq("post-sync pctAccumulatedCurrent (150/250)", post.pctAccumulatedCurrent, 60);
  eq("post-sync newQuantityThisEp (150-120)", post.newQuantityThisEp, 30);
  eq("post-sync amountThisEp (30 × $5.000)", post.amountThisEp, 150000);
  eq("post-sync prevAmountPaid intacto", 600000, 600000);
}

// ============================================================================
console.log("\n📋 Caso 4 — Cambio de versión: cambio de precio");
console.log("V1: 30 m² × $7.500. EP1 cerrado con 30 m² ejecutados ($225.000)");
console.log("V2: 30 m² × $8.000. Sync EP2.");
console.log("→ monto pagado anterior sigue siendo $225.000 (no se recalcula)");
console.log("→ si en EP2 ejecuto cantidad nueva, paga al precio nuevo $8.000");
{
  // Si el maestro completa otra ejecución de 0 m² (todo ya estaba ejecutado), no cambia nada
  const noop = computeEPItem({
    quantity: 30,
    laborUnitPrice: 8000, // ← V2
    quantityExecuted: 30,
    prevExecutedQuantity: 30,
    prevAmountPaid: 225000, // ← intacto, NO se recalcula a 30×8000
  });
  eq("noop amountThisEp", noop.amountThisEp, 0);
  eq("noop totalAccumulated", noop.totalAccumulated, 225000); // sigue siendo $225k

  // Si el cliente agregó 10 m² en V2 → cant_total ahora es 40
  // En EP2, ejecuto cant_ejec=35 (5 m² nuevos)
  const partial = computeEPItem({
    quantity: 40, // V2 amplió la cantidad
    laborUnitPrice: 8000, // V2 cambió precio
    quantityExecuted: 35,
    prevExecutedQuantity: 30,
    prevAmountPaid: 225000, // intacto del EP1
  });
  eq("partial newQuantityThisEp (35-30)", partial.newQuantityThisEp, 5);
  eq("partial amountThisEp (5 × $8.000)", partial.amountThisEp, 40000);
  eq("partial totalAccumulated (225k + 40k)", partial.totalAccumulated, 265000);
}

// ============================================================================
console.log("\n📋 Caso 5 — Sumatorias del EP completo");
{
  const totals = sumEPTotals([
    { quantity: 100, laborUnitPrice: 5000, quantityExecuted: 50, prevExecutedQuantity: 30, prevAmountPaid: 150000 },
    { quantity: 30,  laborUnitPrice: 8000, quantityExecuted: 35, prevExecutedQuantity: 30, prevAmountPaid: 225000 },
  ]);
  eq("totalMoBudget", totals.totalMoBudget, 100*5000 + 30*8000); // $740k
  eq("totalAmountThisEp", totals.totalAmountThisEp, 20*5000 + 5*8000); // $140k
  eq("totalAmountAccumulatedPrev", totals.totalAmountAccumulatedPrev, 150000 + 225000); // $375k
  eq("totalAmountAccumulatedAfterThisEp", totals.totalAmountAccumulatedAfterThisEp, 375000 + 140000);
}

// ============================================================================
console.log("\n📋 Caso extra — pctToQuantity (input invertido)");
{
  eq("50% de 200 m²", pctToQuantity(50, 200), 100);
  eq("clamp negativo a 0", pctToQuantity(-10, 200), 0);
  eq("clamp >100 a 100%", pctToQuantity(150, 200), 200);
}

// ============================================================================
console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
