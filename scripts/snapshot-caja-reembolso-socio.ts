import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { esSocio } from "../src/lib/banco/socios";
import { computeEstadoResultadoCaja } from "../src/lib/dashboard/estadoResultadoCaja";

// Snapshot SOLO LECTURA de la vista Caja del Estado de Resultado, para el
// cambio "reembolso a socio conciliado deja de ser retiro" (CLAUDE.md §4.1).
// Se corre ANTES y DESPUÉS del cambio y se compara el JSON.
//
// Además imprime el diagnóstico de egresos a socio QUE ESTÁN CONCILIADOS a una
// factura: esos son los ÚNICOS movimientos que deberían cambiar de bloque
// (pasan de "Retiros de socios" a gasto de operación). Cualquier otra fila que
// se mueva entre snapshots es un efecto no querido.
//
// Uso: DATABASE_URL=<prod> npx tsx scripts/snapshot-caja-reembolso-socio.ts <year>

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const year = Number(process.argv[2] ?? 2026);
  const host = (process.env.DATABASE_URL ?? "").match(/@([^.]+)/)?.[1] ?? "?";
  console.log(`\n=== DB: ${host}   año: ${year} ===\n`);

  const caja = await computeEstadoResultadoCaja(year);

  const dump = (titulo: string, rows: { label: string; total: number }[]) => {
    console.log(titulo);
    for (const r of rows) console.log(`   ${r.label.padEnd(34)} ${clp(r.total).padStart(16)}`);
    console.log("");
  };

  dump("INGRESOS (operativo)", caja.ingresoRows);
  dump("EGRESOS (operativo)", caja.egresoRows);
  dump("NO OPERATIVO", caja.noOperativoRows);

  console.log("TOTALES ANUALES");
  console.log(`   ingreso operativo     ${clp(caja.totalIngresoAnual).padStart(16)}`);
  console.log(`   egreso operativo      ${clp(caja.totalEgresoOperativoAnual).padStart(16)}`);
  console.log(`   RESULTADO OPERACIÓN   ${clp(caja.resultadoOperacionAnual).padStart(16)}`);
  console.log(`   no operativo          ${clp(caja.totalNoOperativoAnual).padStart(16)}`);
  console.log(`   TOTAL (flujo real)    ${clp(caja.totalAnual).padStart(16)}\n`);

  // ── Diagnóstico: egresos a socio conciliados a factura (los que deben moverse)
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const movs = await prisma.bankMovement.findMany({
    where: { date: { gte: start, lt: end }, type: { not: "abono" } },
    select: {
      date: true, amount: true, status: true,
      counterpartyName: true, counterpartyRut: true, description: true,
      payments: { select: { amountApplied: true, invoice: { select: { folioNumber: true, category: { select: { name: true, parent: { select: { name: true } } } } } } } },
    },
  });

  let nConc = 0, totAplicado = 0, totResto = 0;
  const ejemplos: string[] = [];
  for (const mov of movs) {
    if (mov.status === "neto_cero" || mov.status === "interno") continue;
    if (!esSocio(mov.counterpartyRut, mov.counterpartyName, mov.description)) continue;
    if (!mov.payments.length) continue;
    const aplicado = mov.payments.reduce((s, p) => s + p.amountApplied, 0);
    const resto = Math.abs(mov.amount) - aplicado;
    nConc++;
    totAplicado += aplicado;
    totResto += Math.max(0, resto);
    if (ejemplos.length < 12) {
      const cat = mov.payments[0]?.invoice?.category;
      const catLbl = cat ? (cat.parent?.name ?? cat.name) : "?";
      ejemplos.push(
        `   ${mov.date.toISOString().slice(0, 10)}  ${(mov.counterpartyName ?? "?").slice(0, 20).padEnd(20)}  ` +
        `monto ${clp(Math.abs(mov.amount)).padStart(12)}  aplicado ${clp(aplicado).padStart(12)}  → ${catLbl}`
      );
    }
  }

  console.log("EGRESOS A SOCIO CONCILIADOS A FACTURA (deberían dejar de ser retiro)");
  console.log(`   movimientos: ${nConc}`);
  console.log(`   total aplicado a facturas (→ operación): ${clp(totAplicado)}`);
  console.log(`   total resto no conciliado (sigue retiro): ${clp(totResto)}\n`);
  if (ejemplos.length) {
    console.log("   ejemplos:");
    for (const e of ejemplos) console.log(e);
    console.log("");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
