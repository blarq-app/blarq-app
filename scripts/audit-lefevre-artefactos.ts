/**
 * Audit Lefevre Artefactos V5: hojas del Excel + items cargados via parser,
 * agrupados por hoja/subcategoría/room.
 */
import "dotenv/config";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { parseArtefactos } from "../src/lib/import/parseArtefactos";

const ART =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-SOCIOS/2- PROYECTOS/63_CRISTIAN LEFEVRE/1- Presupuesto/V5/V5_ARTEFACTOS_CRISTIAN LEFEVRE_10.04.26.xlsx";

console.log("=== Hojas del Excel ===");
const wb = XLSX.readFile(ART);
console.log(wb.SheetNames.join("\n"));

console.log("\n=== Items capturados por el parser, agrupados ===");
const buf = fs.readFileSync(ART);
const parsed = parseArtefactos(buf);

const byGroup = new Map<string, { count: number; total: number }>();
for (const it of parsed.items) {
  const key = `${it.subcategory.padEnd(11)} · ${it.room}`;
  const g = byGroup.get(key) ?? { count: 0, total: 0 };
  g.count += 1;
  g.total += it.clientPrice * it.quantity;
  byGroup.set(key, g);
}
let grand = 0;
for (const [k, v] of Array.from(byGroup.entries()).sort()) {
  console.log(
    `  ${k.padEnd(40)} · ${String(v.count).padStart(3)} items · $${Math.round(v.total).toLocaleString("es-CL").padStart(12)}`
  );
  grand += v.total;
}
console.log(
  `  ${"TOTAL".padEnd(40)} · ${String(parsed.items.length).padStart(3)} items · $${Math.round(grand).toLocaleString("es-CL").padStart(12)}`
);

if (parsed.warnings.length > 0) {
  console.log("\nWARNINGS:");
  for (const w of parsed.warnings) console.log(" - " + w);
}

// También listamos todos los items para que MJ vea
console.log("\n=== Todos los items ===");
console.log(
  `${"subcat".padEnd(11)} ${"room".padEnd(17)} ${"item".padEnd(26)} ${"marca".padEnd(13)} qty   list      cp        link`
);
for (const it of parsed.items) {
  console.log(
    `${it.subcategory.padEnd(11)} ${it.room.padEnd(17)} ${(it.name || "").slice(0, 26).padEnd(26)} ${(it.brand || "—").slice(0, 13).padEnd(13)} ${String(it.quantity).padStart(2)} $${String(Math.round(it.listPrice)).padStart(8)} $${String(Math.round(it.clientPrice)).padStart(8)} ${(it.referenceLink || "—").slice(0, 50)}`
  );
}
