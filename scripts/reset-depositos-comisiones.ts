// Saca de "sin_factura" los depósitos en efectivo (ingresos de clientes) y las
// comisiones bancarias (sí tienen factura del Santander). Decisión MJ 2026-06-03.
//
//   deposito_efectivo en sin_factura, sin pago  -> sin_asignar (ingreso a conciliar)
//   comision_bancaria en sin_factura:
//       con pago que cubre el total -> conciliado
//       con pago que NO cubre todo  -> parcial
//       sin pago                     -> sin_asignar (a conciliar con factura Santander)
//
// Respaldo previo a reset-depositos-comisiones-backup.json (reversible).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/reset-depositos-comisiones.ts
// Uso (APLICAR): ...mismo... scripts/reset-depositos-comisiones.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) {
    console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return;
  }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const movs = await prisma.bankMovement.findMany({
    where: { status: "sin_factura", category: { in: ["deposito_efectivo", "comision_bancaria"] } },
    select: { id: true, date: true, amount: true, description: true, category: true,
      payments: { select: { amountApplied: true } } },
    orderBy: { date: "desc" },
  });

  const pagado = (m: typeof movs[number]) => m.payments.reduce((s, p) => s + p.amountApplied, 0);
  const cubierta = (m: typeof movs[number]) => pagado(m) >= Math.abs(m.amount) - 1;

  const aCola = movs.filter((m) => m.payments.length === 0);              // -> sin_asignar
  const conPago = movs.filter((m) => m.payments.length > 0);
  const aConciliado = conPago.filter(cubierta);                          // -> conciliado
  const aParcial = conPago.filter((m) => !cubierta(m));                  // -> parcial

  console.log(`En sin_factura (depósitos + comisiones): ${movs.length}`);
  console.log(`  -> sin_asignar: ${aCola.length}   -> conciliado: ${aConciliado.length}   -> parcial: ${aParcial.length}\n`);

  const fmt = (m: typeof movs[number]) => `  ${m.date.toISOString().slice(0,10)} ${String(m.amount).padStart(11)} [${m.category}] pagado:${pagado(m)}  ${m.description}`;
  console.log("=== a sin_asignar ==="); aCola.forEach((m) => console.log(fmt(m)));
  if (aConciliado.length) { console.log("\n=== a conciliado ==="); aConciliado.forEach((m) => console.log(fmt(m))); }
  if (aParcial.length) { console.log("\n=== a parcial ==="); aParcial.forEach((m) => console.log(fmt(m))); }

  if (!APPLY) { console.log("\nDRY-RUN. --apply para escribir."); await prisma.$disconnect(); return; }

  writeFileSync("reset-depositos-comisiones-backup.json",
    JSON.stringify(movs.map((m) => ({ id: m.id, status: "sin_factura", category: m.category })), null, 2), "utf8");
  console.log("\nRespaldo: reset-depositos-comisiones-backup.json");

  const upd = async (ids: string[], status: string) =>
    ids.length ? (await prisma.bankMovement.updateMany({ where: { id: { in: ids } }, data: { status } })).count : 0;
  const c1 = await upd(aCola.map((m) => m.id), "sin_asignar");
  const c2 = await upd(aConciliado.map((m) => m.id), "conciliado");
  const c3 = await upd(aParcial.map((m) => m.id), "parcial");
  console.log(`LISTO. sin_asignar:${c1} conciliado:${c2} parcial:${c3}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
