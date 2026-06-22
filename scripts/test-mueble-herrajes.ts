/**
 * Test de regresión del cálculo de una partida de herrajes.
 *   npx tsx scripts/test-mueble-herrajes.ts
 */
import { computeHerrajeItemTotals } from "../src/lib/presupuesto/muebleHerrajes";

let pass = 0;
let fail = 0;
function eq(label: string, got: number, want: number) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${label}: got ${got}, want ${want}`);
  }
}

// Caso 1: dos líneas, margen 20%.
//   corredera 10.800 × 4 = 43.200 ; cajón 19.200 × 2 = 38.400 → costo 81.600
//   neto = 81.600 × 1,2 = 97.920 ; c/iva = 97.920 × 1,19 = 116.524,8 → 116.525
{
  const t = computeHerrajeItemTotals(
    [
      { costNet: 10800, quantity: 4 },
      { costNet: 19200, quantity: 2 },
    ],
    0.2,
  );
  eq("c1 costDistributor", t.costDistributor, 81600);
  eq("c1 clientPriceNet", t.clientPriceNet, 97920);
  eq("c1 clientPriceIva", t.clientPriceIva, 116525);
}

// Caso 2: sin líneas → todo 0.
{
  const t = computeHerrajeItemTotals([], 0.2);
  eq("c2 costDistributor", t.costDistributor, 0);
  eq("c2 clientPriceNet", t.clientPriceNet, 0);
  eq("c2 clientPriceIva", t.clientPriceIva, 0);
}

// Caso 3: margen distinto (30%).
//   1.590 × 6 = 9.540 ; neto = 9.540 × 1,3 = 12.402 ; c/iva = 14.758,38 → 14.758
{
  const t = computeHerrajeItemTotals([{ costNet: 1590, quantity: 6 }], 0.3);
  eq("c3 costDistributor", t.costDistributor, 9540);
  eq("c3 clientPriceNet", t.clientPriceNet, 12402);
  eq("c3 clientPriceIva", t.clientPriceIva, 14758);
}

// Caso 4: cantidad fraccionaria no rompe (por las dudas).
{
  const t = computeHerrajeItemTotals([{ costNet: 1000, quantity: 1.5 }], 0.2);
  eq("c4 costDistributor", t.costDistributor, 1500);
}

console.log(`\n${pass} OK, ${fail} fallaron`);
process.exit(fail > 0 ? 1 : 0);
