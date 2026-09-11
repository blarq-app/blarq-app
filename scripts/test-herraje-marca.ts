/**
 * Test de regresión de qué proveedor/marca de herraje ve el cliente.
 *   npx tsx scripts/test-herraje-marca.ts
 */
import { proveedorParaCliente } from "../src/lib/presupuesto/herrajeMarca";

let pass = 0;
let fail = 0;
function eq(label: string, got: string, want: string) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

eq("proveedor solo", proveedorParaCliente("DPH", null), "DPH");
eq("marca del catálogo = proveedor → no se duplica", proveedorParaCliente("DPH", "DPH"), "DPH");
eq("mayúsculas/espacios no importan", proveedorParaCliente("DPH", " dph "), "DPH");
eq("marca real delante del proveedor", proveedorParaCliente("DPH", "Blum"), "Blum · DPH");
eq("sin proveedor, con marca", proveedorParaCliente(null, "Hettich"), "Hettich");
eq("nada", proveedorParaCliente("", "  "), "");

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
