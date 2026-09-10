/**
 * Test de regresión del criterio "qué partidas de muebles suman" (pendiente 177).
 * Puro, sin base de datos.
 *   npx tsx scripts/test-mueble-items.ts
 */
import {
  soloPrincipales,
  esAlternativa,
  alternativasDe,
  agruparConAlternativas,
  diferenciaConBase,
  formatDiferencia,
  soloLoQueCambia,
} from "../src/lib/presupuesto/muebleItems";

let pass = 0;
let fail = 0;
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.error(`FAIL ${label}: got ${g}, want ${w}`);
  }
}

const fmt = (n: number) => "$" + n.toLocaleString("es-CL");

// Candelaria V5: MUEBLES en Vesto (base) con Gizir y Egger como alternativas,
// más HERRAJES y CUBIERTA como partidas base normales.
const vesto = { id: "vesto", alternativeOfId: null, clientPriceIva: 22_104_581, quantity: 1 };
const gizir = { id: "gizir", alternativeOfId: "vesto", clientPriceIva: 22_872_190, quantity: 1 };
const egger = { id: "egger", alternativeOfId: "vesto", clientPriceIva: 23_441_962, quantity: 1 };
const herrajes = { id: "herr", alternativeOfId: null, clientPriceIva: 5_000_000, quantity: 1 };
const cubierta = { id: "cub", alternativeOfId: null, clientPriceIva: 3_166_910, quantity: 1 };
const items = [vesto, gizir, egger, herrajes, cubierta];

// 1. Solo las base suman.
eq("principales ids", soloPrincipales(items).map((i) => i.id), ["vesto", "herr", "cub"]);
eq(
  "total solo base",
  soloPrincipales(items).reduce((s, i) => s + i.clientPriceIva * i.quantity, 0),
  30_271_491,
);

// 2. Objetos viejos sin la columna (fotos de enviado anteriores) cuentan como base.
eq("sin campo = base", esAlternativa({} as { alternativeOfId?: string | null }), false);
eq("undefined = base", esAlternativa({ alternativeOfId: undefined }), false);
eq("null = base", esAlternativa({ alternativeOfId: null }), false);
eq("con id = alternativa", esAlternativa({ alternativeOfId: "x" }), true);

// 3. Alternativas de una base, en orden.
eq("alternativas de vesto", alternativasDe(items, "vesto").map((i) => i.id), ["gizir", "egger"]);
eq("alternativas de herrajes", alternativasDe(items, "herr").length, 0);

// 4. Agrupado: base + alternativas colgadas; una alternativa huérfana no se cuela.
const huerfana = { id: "huer", alternativeOfId: "no-existe", clientPriceIva: 1, quantity: 1 };
const grupos = agruparConAlternativas([...items, huerfana]);
eq("grupos bases", grupos.map((g) => g.base.id), ["vesto", "herr", "cub"]);
eq("grupo vesto alternativas", grupos[0].alternativas.map((a) => a.id), ["gizir", "egger"]);
eq("huerfana no aparece", grupos.some((g) => g.base.id === "huer"), false);

// 5. Diferencia contra la base (Candelaria: +$767.609 y +$1.337.381).
eq("dif gizir", diferenciaConBase(gizir, vesto), 767_609);
eq("dif egger", diferenciaConBase(egger, vesto), 1_337_381);
eq("dif con cantidad", diferenciaConBase({ clientPriceIva: 100, quantity: 2 }, { clientPriceIva: 150, quantity: 1 }), 50);

// 6. Formato: signo siempre, cero vacío, menos tipográfico.
eq("fmt positivo", formatDiferencia(767_609, fmt), "+$767.609");
eq("fmt negativo", formatDiferencia(-658_575, fmt), "−$658.575");
eq("fmt cero", formatDiferencia(0, fmt), "");
eq("fmt casi cero", formatDiferencia(0.4, fmt), "");

// 7. Solo lo que cambia entre el desglose de la alternativa y el de la base.
const baseDet = [
  { name: "CUERPO INTERIOR", material: "MELAMINA BLANCA 18MM" },
  { name: "FRENTE MUEBLE BASE", material: "MELAMINA VESTO GRIS" },
  { name: "FRENTE MUEBLE MURAL", material: "MELAMINA VESTO GRIS" },
  { name: "ZOCALO", material: "TERCIADO" },
];
const altDet = [
  { name: "Cuerpo interior", material: "melamina blanca  18mm" }, // igual, salvo mayúsculas/espacios
  { name: "FRENTE MUEBLE BASE", material: "MELAMINA GIZIR GRIS" },
  { name: "FRENTE MUEBLE MURAL", material: "MELAMINA GIZIR GRIS" },
  { name: "ZOCALO", material: "TERCIADO" },
  { name: "TIRADORES", material: "PERFIL GOLA ALUMINIO" }, // nuevo en la alternativa
];
eq(
  "cambian los dos frentes y el componente nuevo",
  soloLoQueCambia(altDet, baseDet).map((d) => d.name),
  ["FRENTE MUEBLE BASE", "FRENTE MUEBLE MURAL", "TIRADORES"],
);
eq("desglose idéntico → nada", soloLoQueCambia(baseDet, baseDet).length, 0);
eq("base sin desglose → todo es cambio", soloLoQueCambia(altDet, []).length, 5);

console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail > 0 ? 1 : 0);
