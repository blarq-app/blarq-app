// Test de regresión del helper de zona-por-posición (annotateZones).
// Cubre el caso real de Paseo del Sena V2 (eléctricas): COCINA, BAÑOS y un
// "extractor" recién creado SIN zona que cae al fondo y debe heredar BAÑOS.
// Correr: npx tsx scripts/test-zones.ts
import { annotateZones } from "../src/lib/presupuesto/zones";

let fail = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    fail++;
    console.error(`  FALLA: ${name}`);
  } else {
    console.log(`  ok: ${name}`);
  }
}

// Orden tal como queda por sortOrder en el editor: COCINA (×2), BAÑOS (×2),
// y el extractor sin zona al final.
const items = [
  { subChapter: "COCINA", total: 100, name: "luminaria" },
  { subChapter: "COCINA", total: 50, name: "arranque" },
  { subChapter: "BAÑOS", total: 200, name: "modulo" },
  { subChapter: "BAÑOS", total: 40, name: "luminaria baño" },
  { subChapter: null, total: 37, name: "extractor" }, // sin zona → hereda BAÑOS
];

const { rows, zoneSubtotals, showZoneSubtotals } = annotateZones(items);

console.log("Caso Sena (extractor sin zona al fondo de BAÑOS):");
check("extractor hereda BAÑOS", rows[4].zone === "BAÑOS");
check("encabezado en la 1ª de COCINA", rows[0].isZoneStart === true);
check("sin encabezado en la 2ª de COCINA", rows[1].isZoneStart === false);
check("encabezado al empezar BAÑOS", rows[2].isZoneStart === true);
check("sin encabezado en el extractor", rows[4].isZoneStart === false);
check("subtotal COCINA = 150", zoneSubtotals.get("COCINA") === 150);
check(
  "subtotal BAÑOS = 277 (incluye extractor)",
  zoneSubtotals.get("BAÑOS") === 277
);
check("muestra subtotales (2 zonas)", showZoneSubtotals === true);

console.log("\nCaso partidas sin zona arriba del capítulo:");
const sinZona = annotateZones([
  { subChapter: null, total: 10, name: "a" },
  { subChapter: null, total: 20, name: "b" },
]);
check("ninguna abre zona", sinZona.rows.every((r) => r.zone === null));
check("ningún encabezado", sinZona.rows.every((r) => !r.isZoneStart));
check("una sola zona efectiva ('')", sinZona.showZoneSubtotals === false);

console.log("\nCaso una sola zona (no mostrar subtotales redundantes):");
const unaZona = annotateZones([
  { subChapter: "COCINA", total: 10, name: "a" },
  { subChapter: null, total: 20, name: "b" }, // hereda COCINA
]);
check("la 2ª hereda COCINA", unaZona.rows[1].zone === "COCINA");
check("no muestra subtotal redundante", unaZona.showZoneSubtotals === false);

if (fail > 0) {
  console.error(`\n${fail} chequeo(s) fallaron`);
  process.exit(1);
}
console.log("\nTodos los chequeos pasaron.");
