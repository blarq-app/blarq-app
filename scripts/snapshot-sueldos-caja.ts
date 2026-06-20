import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeFondoSueldos, PROJECT_FONDO_INCLUDE } from "../src/lib/banco/fondoSueldos";
import { computeEstadoResultadoCaja } from "../src/lib/dashboard/estadoResultadoCaja";

// Snapshot SOLO LECTURA de las dos vistas que dependen (directa o
// indirectamente) de cómo se categorizan los movimientos del banco:
//   - Fondo de Sueldos (saldo cta sueldos vs fondo teórico generado)
//   - Estado de Resultado vista Caja (filas Sueldos / Retiros / No asignado)
// Se corre ANTES y DESPUÉS de tocar el import para confirmar que los totales
// no se mueven (CLAUDE.md §4.1). Uso: npx tsx scripts/snapshot-sueldos-caja.ts <year>

async function main() {
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  const host = (process.env.DATABASE_URL ?? "").match(/@([^.]+)/)?.[1] ?? "?";
  console.log(`DB: ${host}   year: ${year}\n`);

  // ── Fondo de Sueldos ────────────────────────────────────────────────
  const projects = await prisma.project.findMany({
    where: { isInternal: false, status: { in: ["cotizacion", "ejecucion"] } },
    include: PROJECT_FONDO_INCLUDE,
  });
  const totalFondoGenerado = projects
    .map((p) => computeFondoSueldos(p).fondoGenerado)
    .reduce((s, v) => s + v, 0);
  const ctaSueldos = await prisma.bankAccount.findFirst({ where: { role: "salary_fund" } });
  const saldoSueldos = ctaSueldos?.lastKnownBalance ?? null;

  console.log("FONDO SUELDOS");
  console.log(`  fondo generado teórico : $${Math.round(totalFondoGenerado).toLocaleString("es-CL")}`);
  console.log(`  saldo cta sueldos      : ${saldoSueldos === null ? "—" : "$" + saldoSueldos.toLocaleString("es-CL")}`);
  console.log(`  drift                  : ${saldoSueldos === null ? "—" : "$" + Math.round(totalFondoGenerado - saldoSueldos).toLocaleString("es-CL")}\n`);

  // ── Estado de Resultado vista Caja ──────────────────────────────────
  const caja = await computeEstadoResultadoCaja(year);
  const find = (rows: { label: string; total: number }[], label: string) =>
    rows.find((r) => r.label === label)?.total ?? 0;

  console.log("ESTADO RESULTADO — CAJA");
  console.log(`  total ingreso anual            : $${Math.round(caja.totalIngresoAnual).toLocaleString("es-CL")}`);
  console.log(`  total egreso operativo anual   : $${Math.round(caja.totalEgresoOperativoAnual).toLocaleString("es-CL")}`);
  console.log(`  resultado operación anual      : $${Math.round(caja.resultadoOperacionAnual).toLocaleString("es-CL")}`);
  console.log(`  total no operativo anual       : $${Math.round(caja.totalNoOperativoAnual).toLocaleString("es-CL")}`);
  console.log(`  TOTAL ANUAL (flujo real)       : $${Math.round(caja.totalAnual).toLocaleString("es-CL")}`);
  console.log(`  · fila "Sueldos" (operativo)   : $${Math.round(find(caja.egresoRows, "Sueldos")).toLocaleString("es-CL")}`);
  console.log(`  · fila "Retiros de socios"     : $${Math.round(find(caja.noOperativoRows, "Retiros de socios")).toLocaleString("es-CL")}`);
  console.log(`  · fila "No asignado" (egreso)  : $${Math.round(find(caja.egresoRows, "No asignado")).toLocaleString("es-CL")}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
