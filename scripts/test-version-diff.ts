/**
 * Test de regresión para la lógica pura de comparación entre versiones de
 * presupuesto (marcas subió/bajó/nuevo). No toca la BD.
 *
 * Correr: npx tsx scripts/test-version-diff.ts
 */
import { computeChangeMarkers } from "../src/lib/presupuesto/versionDiff";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

// Base: lo que el cliente vio (última versión enviada).
const baseline = [
  { lineageId: "a", total: 100000 },
  { lineageId: "b", total: 80000 },
  { lineageId: "c", total: 50000 },
];

// Versión actual: a subió, b bajó, c igual, d es nueva (c borrada no aparece).
const current = [
  { lineageId: "a", total: 150000 }, // subió
  { lineageId: "b", total: 60000 }, // bajó
  { lineageId: "c", total: 50000 }, // igual
  { lineageId: "d", total: 30000 }, // nueva
];

const m = computeChangeMarkers(current, baseline);

check("a subió", m.get("a")?.marker === "up");
check("a guarda prevTotal", m.get("a")?.prevTotal === 100000);
check("b bajó", m.get("b")?.marker === "down");
check("c sin cambio", m.get("c")?.marker === null);
check("d es nueva", m.get("d")?.marker === "added");
check("d sin prevTotal", m.get("d")?.prevTotal === null);

// Tolerancia: diferencia de $0,5 no marca nada (redondeo).
const m2 = computeChangeMarkers(
  [{ lineageId: "a", total: 100000.5 }],
  [{ lineageId: "a", total: 100000 }]
);
check("diferencia de redondeo no marca", m2.get("a")?.marker === null);

// Sin base (ej. V1): todo null.
const m3 = computeChangeMarkers([{ lineageId: "a", total: 100000 }], null);
check("sin versión base no marca nada", m3.get("a")?.marker === null);

// Base vacía (versión enviada sin partidas): todo se considera nuevo.
const m4 = computeChangeMarkers([{ lineageId: "a", total: 100000 }], []);
check("base vacía → todo nuevo", m4.get("a")?.marker === "added");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
