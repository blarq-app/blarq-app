// Snapshot SOLO LECTURA de los totales anuales del Estado de Resultado (vista
// Caja) usando la MISMA función que la app (computeEstadoResultadoCaja). Sirve
// para probar, antes/después de la corrección de datos, que el total NO se mueve.
//
// Conecta a la base que se le pase por env: lee DATABASE_URL del archivo y lo
// pone en process.env ANTES de importar @/lib/prisma (que hace new PrismaClient()
// sin url explícita → toma process.env.DATABASE_URL). NO importa dotenv, así que
// nada pisa la url. Uso: npx tsx scripts/diag-eerr-snapshot.ts <ruta-env>
import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Falta la ruta al .env");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
process.env.DATABASE_URL = url;
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  const { computeEstadoResultadoCaja } = await import("@/lib/dashboard/estadoResultadoCaja");
  for (const year of [2025, 2026]) {
    const e = await computeEstadoResultadoCaja(year);
    console.log(`\n── AÑO ${year} ──`);
    console.log(`  Ingresos operativos:      ${clp(e.totalIngresoAnual)}`);
    console.log(`  Egresos operativos:       ${clp(e.totalEgresoOperativoAnual)}`);
    console.log(`  Resultado de operación:   ${clp(e.resultadoOperacionAnual)}`);
    console.log(`  No operativo:             ${clp(e.totalNoOperativoAnual)}`);
    console.log(`  TOTAL DEL AÑO:            ${clp(e.totalAnual)}`);
    // Filas que podrían moverse si el fix tuviera efecto: la de sueldos (no
    // operativo) y los reembolsos operativos. Las mostramos para verlas al peso.
    const sueldoRow = e.noOperativoRows.find((r) => r.label === "Sueldos socios");
    console.log(`    · fila "Sueldos socios" (no op): ${sueldoRow ? clp(sueldoRow.total) : "(no existe)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });
