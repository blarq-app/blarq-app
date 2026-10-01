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
  extraerPrecioExactoDph,
  avisoCostoDeLaWeb,
} from "../src/lib/presupuesto/herrajeProveedores";
import { extractGenericProductData } from "../src/lib/catalog/fetchArtefactoData";

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
eq("DPH + link DPH → llena", extraerPrecioExactoDph("DPH", DPH_LINK), true);
eq("HBT + link HBT → NO llena", extraerPrecioExactoDph("HBT", HBT_LINK), false);
eq("pestaña DPH olvidada + link HBT → NO llena", extraerPrecioExactoDph("DPH", HBT_LINK), false);
eq("HBT + link DPH → NO llena", extraerPrecioExactoDph("HBT", DPH_LINK), false);
eq("Ducasse → NO llena", extraerPrecioExactoDph("DAPDUCASSE", "https://dapducasse.cl/x.html"), false);
eq("DPH + sitio desconocido → NO llena", extraerPrecioExactoDph("DPH", "https://tienda.cl/x"), false);
eq("dph + www.dph.cl → llena", extraerPrecioExactoDph(" dph ", "https://www.dph.cl/products/x"), true);
eq("Carlos (otro) → NO llena", extraerPrecioExactoDph("Carlos", "https://tienda.cl/x"), false);

// Aviso de "Extraer" cuando el costo sale del precio de la web (todo lo que
// no es DPH con variante exacta). Desde 2026-10-01 el costo se llena también
// en HBT (pedido de MJ) y el aviso recuerda cambiarlo si negoció otro.
eq("aviso HBT con precio web", avisoCostoDeLaWeb("HBT", HBT_LINK, 10990),
  "Costo = precio de la web de HBT ($10.990). Si negociaste otro precio, cambialo.");
eq("aviso HBT sin precio web", avisoCostoDeLaWeb("HBT", HBT_LINK, null),
  "HBT: la web no muestra el precio. Escribí el costo a mano.");
eq("aviso pestaña DPH + link HBT → manda el sitio", avisoCostoDeLaWeb("DPH", HBT_LINK, 10990),
  "Costo = precio de la web de HBT ($10.990). Si negociaste otro precio, cambialo.");
eq("aviso sitio desconocido → el host", avisoCostoDeLaWeb("DPH", "https://www.tienda.cl/x", 5000),
  "Costo = precio de la web de tienda.cl ($5.000). Si negociaste otro precio, cambialo.");
eq("aviso Ducasse", avisoCostoDeLaWeb("DAPDUCASSE", "https://dapducasse.cl/x.html", 2980),
  "Costo = precio de la web de DAPDUCASSE ($2.980). Si negociaste otro precio, cambialo.");
eq("aviso otro proveedor, sitio desconocido, sin precio", avisoCostoDeLaWeb("Carlos", "https://tienda.cl/x", null),
  "tienda.cl: la web no muestra el precio. Escribí el costo a mano.");

// El lector que usa el NAVEGADOR cuando hbt.cl bloquea al servidor: misma
// forma que la página real de hbt.cl (Magento, og:title en entidades hex).
const HBT_HTML = `<html><head>
<meta property="og:type" content="product" />
<meta property="og:title" content="Manilla&#x20;Edge&#x20;S&#x20;Bronce&#x20;160&#x2F;200mm" />
<meta property="og:image" content="https://www.hbt.cl/media/catalog/product/cache/x/8/6/foto.jpg" />
<meta property="product:price:amount" content="10990"/>
</head><body></body></html>`;
const leido = extractGenericProductData(HBT_LINK, HBT_HTML, "hbt");
eq("HBT: nombre decodificado", leido.name, "Manilla Edge S Bronce 160/200mm");
eq("HBT: foto", leido.imageUrl, "https://www.hbt.cl/media/catalog/product/cache/x/8/6/foto.jpg");
eq("HBT: precio web de referencia", leido.listPrice, 10990);

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
