/**
 * Test de regresión de qué marca de herraje ve el cliente.
 *   npx tsx scripts/test-herraje-marca.ts
 */
import { marcaParaCliente } from "../src/lib/presupuesto/herrajeMarca";

let pass = 0;
let fail = 0;
function eq(label: string, got: string | null, want: string | null) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

eq("marca real", marcaParaCliente("Blum", "DPH"), "Blum");
eq("la marca es el proveedor → nada", marcaParaCliente("DPH", "DPH"), null);
eq("mayúsculas/espacios no importan", marcaParaCliente(" dph ", "DPH"), null);
eq("sin marca", marcaParaCliente(null, "HBT"), null);
eq("marca vacía", marcaParaCliente("  ", "HBT"), null);
eq("sin proveedor, con marca", marcaParaCliente("Hettich", null), "Hettich");

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
