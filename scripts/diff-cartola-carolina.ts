/**
 * READ-ONLY. Compara las transferencias de Carolina Ovalle de la cartola
 * del banco (Excel) contra lo que tiene la app (BankMovement).
 * Reporta cuáles del Excel faltan en la app.
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const EXCEL = "/Users/mjblanco/Downloads/MovimientosCartola_20260516_0913.xlsx";

async function main() {
  // 1. Excel
  const wb = XLSX.readFile(EXCEL);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[wb.SheetNames[0]]
  );
  const xls = rows.map((r) => ({
    fecha: String(r["fecha_transaccion"] ?? "").slice(0, 10),
    monto: Number(r["monto"]) || 0,
    desc: String(r["descripcion"] ?? ""),
  }));
  console.log(`Excel cartola: ${xls.length} movimientos\n`);

  // 2. App — BankMovements que parezcan de Carolina Ovalle
  const movs = await prisma.bankMovement.findMany({
    where: {
      OR: [
        { description: { contains: "carolina", mode: "insensitive" } },
        { description: { contains: "ovalle", mode: "insensitive" } },
        { counterpartyName: { contains: "carolina", mode: "insensitive" } },
        { counterpartyName: { contains: "ovalle", mode: "insensitive" } },
      ],
    },
    select: { id: true, date: true, amount: true, description: true, status: true },
    orderBy: { date: "desc" },
  });
  console.log(`App BankMovement (carolina/ovalle): ${movs.length} movimientos\n`);

  // 3. Match por (fecha, monto). Marca los del Excel que no están en la app.
  const appKeys = new Map<string, number>();
  for (const m of movs) {
    const key = `${m.date.toISOString().slice(0, 10)}|${Math.round(m.amount)}`;
    appKeys.set(key, (appKeys.get(key) ?? 0) + 1);
  }
  const xlsKeys = new Map<string, number>();
  for (const x of xls) {
    const key = `${x.fecha}|${x.monto}`;
    xlsKeys.set(key, (xlsKeys.get(key) ?? 0) + 1);
  }

  console.log("=== EN EL EXCEL PERO NO (o de menos) EN LA APP ===");
  let faltan = 0;
  for (const x of xls.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const key = `${x.fecha}|${x.monto}`;
    const inApp = appKeys.get(key) ?? 0;
    const inXls = xlsKeys.get(key) ?? 0;
    if (inApp < inXls) {
      // contar cuántas veces ya reportamos esta key
      console.log(
        `  ${x.fecha}  ${x.monto.toLocaleString("es-CL").padStart(13)}  ${x.desc}  (excel:${inXls} app:${inApp})`
      );
      faltan++;
      appKeys.set(key, inApp + 1); // evita doble-reporte de la misma key
    }
  }
  if (faltan === 0) console.log("  (ninguna — todas están en la app)");

  console.log("\n=== EN LA APP PERO NO EN EL EXCEL ===");
  const appKeys2 = new Map<string, number>();
  for (const m of movs) {
    const key = `${m.date.toISOString().slice(0, 10)}|${Math.round(m.amount)}`;
    appKeys2.set(key, (appKeys2.get(key) ?? 0) + 1);
  }
  let sobran = 0;
  for (const m of movs.sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const key = `${m.date.toISOString().slice(0, 10)}|${Math.round(m.amount)}`;
    const inXls = xlsKeys.get(key) ?? 0;
    const inApp = appKeys2.get(key) ?? 0;
    if (inXls < inApp) {
      console.log(
        `  ${m.date.toISOString().slice(0, 10)}  ${Math.round(m.amount).toLocaleString("es-CL").padStart(13)}  ${m.description}  · ${m.status}`
      );
      sobran++;
      xlsKeys.set(key, inXls + 1);
    }
  }
  if (sobran === 0) console.log("  (ninguna)");

  const totalXls = xls.reduce((s, x) => s + x.monto, 0);
  const totalApp = movs.reduce((s, m) => s + m.amount, 0);
  console.log(
    `\nTotal Excel: ${totalXls.toLocaleString("es-CL")} (${xls.length})`
  );
  console.log(
    `Total App:   ${Math.round(totalApp).toLocaleString("es-CL")} (${movs.length})`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
