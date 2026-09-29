/**
 * Test de regresión de las pestañas de proveedor de herrajes.
 *   npx tsx scripts/test-herraje-proveedores.ts
 */
import {
  proveedoresDe,
  normalizarProveedor,
  seComparaConLaWeb,
  motivoSinCompararWeb,
  proveedorDelLink,
  extraerLlenaCosto,
} from "../src/lib/presupuesto/herrajeProveedores";

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

// Comparar con la web (pendiente 143): solo DPH. HBT tiene precio negociado.
eq("DPH se compara", seComparaConLaWeb("DPH"), true);
eq("dph con espacios se compara", seComparaConLaWeb(" dph "), true);
eq("HBT NO se compara", seComparaConLaWeb("HBT"), false);
eq("Ducasse NO se compara", seComparaConLaWeb("DAPDUCASSE"), false);
eq("vacío NO se compara", seComparaConLaWeb(""), false);
eq("motivo HBT", motivoSinCompararWeb("HBT"), "precio negociado");
eq("motivo otro", motivoSinCompararWeb("DAPDUCASSE"), "su web no se lee");

// "Extraer" llena el costo solo con DPH (pendiente 188): HBT es negociado.
const HBT_LINK = "https://www.hbt.cl/manilla-edge-s-cobre-160-200mm-pack-x1.html?srsltid=abc";
const DPH_LINK = "https://dph.cl/products/cajon-metalico-blanco-frente-madera-altura-119mm";
eq("sitio hbt.cl (con www y parámetro de Google)", proveedorDelLink(HBT_LINK), "HBT");
eq("sitio dph.cl", proveedorDelLink(DPH_LINK), "DPH");
eq("sitio desconocido", proveedorDelLink("https://tienda.cl/x"), null);
eq("link roto", proveedorDelLink("no es link"), null);
eq("DPH + link DPH → llena", extraerLlenaCosto("DPH", DPH_LINK), true);
eq("HBT + link HBT → NO llena", extraerLlenaCosto("HBT", HBT_LINK), false);
eq("pestaña DPH olvidada + link HBT → NO llena", extraerLlenaCosto("DPH", HBT_LINK), false);
eq("HBT + link DPH → NO llena", extraerLlenaCosto("HBT", DPH_LINK), false);
eq("Ducasse → NO llena", extraerLlenaCosto("DAPDUCASSE", "https://dapducasse.cl/x.html"), false);
eq("DPH + sitio desconocido → NO llena", extraerLlenaCosto("DPH", "https://tienda.cl/x"), false);
eq("dph + www.dph.cl → llena", extraerLlenaCosto(" dph ", "https://www.dph.cl/products/x"), true);
eq("Carlos (otro) → NO llena", extraerLlenaCosto("Carlos", "https://tienda.cl/x"), false);

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
