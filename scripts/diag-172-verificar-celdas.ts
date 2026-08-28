/**
 * Abre los dos Excel generados y muestra qué quedó en las celdas P.U. / TOTAL
 * y en la fila TOTAL: que el CON precios traiga el número y el SIN precios
 * siga vacío. Verificación del pendiente 172.
 *
 * Uso: npx tsx scripts/diag-172-verificar-celdas.ts [carpeta]
 */
import ExcelJS from "exceljs";

const OUT = process.argv[2] ?? "/tmp/maestro-172";

async function revisar(file: string, rotulo: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  console.log(`\n══ ${rotulo} ══  ${file.split("/").pop()}`);
  console.log(`Subtítulo E3: ${JSON.stringify(ws.getCell("E3").value)}`);
  console.log(`Nota A9: ${String(ws.getCell("A9").value).slice(0, 110)}…`);

  // Primeras 3 filas con contenido en la columna ITEM tipo "n.m"
  let mostradas = 0;
  let ultimaFila = 0;
  ws.eachRow((row, n) => {
    ultimaFila = n;
    const item = row.getCell(1).value;
    if (typeof item === "string" && /^\d+\.\d+$/.test(item) && mostradas < 3) {
      mostradas++;
      const pu = row.getCell(6).value;
      const total = row.getCell(7).value;
      console.log(
        `  fila ${n} · ${item} ${String(row.getCell(2).value).slice(0, 26)}` +
          ` · cant ${JSON.stringify(row.getCell(5).value)}` +
          ` · P.U. ${JSON.stringify(pu)}` +
          ` · TOTAL ${JSON.stringify(total)}`
      );
    }
  });

  const filaTotal = ws.getRow(ultimaFila);
  console.log(
    `  FILA TOTAL (${ultimaFila}): ${JSON.stringify(filaTotal.getCell(1).value)}` +
      ` → ${JSON.stringify(filaTotal.getCell(7).value)}`
  );
}

async function main() {
  await revisar(
    `${OUT}/BLARQ_Cotizacion_Maestro_Casa_Los_Algarrobos_V3.xlsx`,
    "SIN precios"
  );
  await revisar(
    `${OUT}/BLARQ_Cotizacion_Maestro_CON_PRECIOS_Casa_Los_Algarrobos_V3.xlsx`,
    "CON precios"
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
