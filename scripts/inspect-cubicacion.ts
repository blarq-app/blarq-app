import * as XLSX from "xlsx";

const file =
  "/Users/mjblanco/Library/CloudStorage/GoogleDrive-mjblanco@blarq.cl/Unidades compartidas/BLARQ-ESTUDIO/1-COTIZACIONES/159_VERONICA VILLARRAEL/4- PRESUPUESTO/V1/V1_CUBICACION_VERONICA VILLARREAL_05.05.26.xlsx";

const wb = XLSX.readFile(file, { cellDates: true });
console.log("Hojas:", wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  console.log(`\n=== Hoja: ${sheetName} ===`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  console.log(`Filas: ${rows.length}`);
  const max = Math.min(rows.length, 40);
  for (let r = 0; r < max; r++) {
    const cells = rows[r].slice(0, 10).map((v) => {
      if (v === "" || v == null) return "·";
      if (typeof v === "number") return v.toString();
      return String(v).slice(0, 50);
    });
    console.log(`  [${r}]`, cells.join(" | "));
  }
  if (rows.length > max) console.log(`  ... (+${rows.length - max} filas más)`);
}
