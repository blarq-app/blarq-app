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

// Ruido de decimales: un recálculo ensució el precio unitario (8179 → 8179,424)
// sin que nadie tocara la partida. El total crudo se mueve $9,75, pero al
// comparar sobre el precio REDONDEADO (lo que ve el cliente) ambos dan $188.117
// → no debe pintar flecha. Caso real: Pintura de cielos, Paseo del Sena V2.
const m5 = computeChangeMarkers(
  [{ lineageId: "a", unitPrice: 8179.424, quantity: 23, total: 188126.752 }],
  [{ lineageId: "a", unitPrice: 8179, quantity: 23, total: 188117 }]
);
check("decimales fantasma del recálculo no marcan", m5.get("a")?.marker === null);

// Cambio real de precio unitario ($20.000 → $30.000): sí debe marcar. Caso
// real: Instalación de puertas, Paseo del Sena V2 (MJ lo subió a propósito).
const m6 = computeChangeMarkers(
  [{ lineageId: "a", unitPrice: 30000, quantity: 2, total: 60000 }],
  [{ lineageId: "a", unitPrice: 20000, quantity: 2, total: 40000 }]
);
check("cambio real de precio unitario marca up", m6.get("a")?.marker === "up");
check("prevTotal del cambio real es el redondeado", m6.get("a")?.prevTotal === 40000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
