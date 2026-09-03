/**
 * Abre los Excel generados y muestra las fórmulas de la columna TOTAL (G):
 * las de cada partida, las de subtotal de capítulo y la del TOTAL del pie.
 * Sirve para confirmar que el pie NO cuenta dos veces (antes sumaba el rango
 * corrido, que ahora incluiría los subtotales) y que cada fórmula trae su
 * `result` resuelto.
 *
 * Uso: npx tsx scripts/diag-173-verificar-excel.ts /tmp/173/forma-a/archivo.xlsx
 */
import ExcelJS from "exceljs";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Falta la ruta del .xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  console.log(`\n${file}\n`);
  let sumaDeSubtotales = 0;

  ws.eachRow((row, n) => {
    const g = row.getCell(7).value as
      | { formula?: string; result?: unknown }
      | number
      | null;
    if (!g || typeof g !== "object" || !("formula" in g)) return;
    const etiqueta = String(row.getCell(2).value ?? row.getCell(1).value ?? "");
    const esPartida = /^=E\d+\*F\d+$|^E\d+\*F\d+$/.test(g.formula ?? "");
    if (esPartida) return; // las de partida son ruido acá

    console.log(
      `  fila ${String(n).padStart(4)} | ${etiqueta.slice(0, 40).padEnd(42)}` +
        ` | =${g.formula} -> ${g.result}`
    );
    if (String(g.formula).startsWith("SUM(G") && !String(g.formula).includes(",")) {
      sumaDeSubtotales += Number(g.result ?? 0);
    }
  });

  console.log(
    `\n  suma de los subtotales (results): ${sumaDeSubtotales.toLocaleString(
      "es-CL"
    )}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
