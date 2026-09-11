/**
 * Test de regresión de las pestañas de proveedor de herrajes.
 *   npx tsx scripts/test-herraje-proveedores.ts
 */
import { proveedoresDe, normalizarProveedor } from "../src/lib/presupuesto/herrajeProveedores";

let pass = 0;
let fail = 0;
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.error(`FAIL ${label}: got ${g}, want ${w}`); }
}

eq("sin herrajes → los fijos", proveedoresDe([]), ["DPH", "HBT"]);
eq("solo fijos, en su orden", proveedoresDe([{ supplier: "HBT" }, { supplier: "DPH" }]), ["DPH", "HBT"]);
eq("otros al final, alfabéticos", proveedoresDe([{ supplier: "Carlos" }, { supplier: "DPH" }, { supplier: "Alvi" }]), ["DPH", "HBT", "Alvi", "Carlos"]);
eq("espacios sobrantes no crean duplicados", proveedoresDe([{ supplier: " Carlos " }, { supplier: "Carlos" }]), ["DPH", "HBT", "Carlos"]);
eq("vacío se ignora", proveedoresDe([{ supplier: "" }, { supplier: "  " }]), ["DPH", "HBT"]);
eq("mayúsculas NO se tocan (lo decide MJ)", proveedoresDe([{ supplier: "carlos" }, { supplier: "Carlos" }]), ["DPH", "HBT", "carlos", "Carlos"]);
eq("normalizar", normalizarProveedor("  Carlos   Mueblista "), "Carlos Mueblista");

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
