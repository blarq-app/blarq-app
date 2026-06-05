// Saca de "sin_factura" los movimientos que fueron mal clasificados por el
// bug del prefijo "Compra" (category="compra_tarjeta"). Esos en realidad casi
// todos tienen factura — al quedar "sin_factura" se escondían de la cola de
// conciliación. Los devuelve a la cola para conciliar/clasificar.
//
// Decisión MJ 2026-06-03. NO toca: sueldo, previred, comision_bancaria,
// deposito_efectivo, otro_sin_factura (esos están bien o los marcó MJ a mano).
//
// Dos acciones, ambas solo sobre category="compra_tarjeta":
//   1. status="sin_factura" + SIN imputación  -> status="sin_asignar"
//      (vuelven a la cola de pendientes; el auto-match las puede conciliar)
//   2. status="sin_factura" + CON imputación  -> status="conciliado"
//      (ya tienen pago linkeado: era drift de estado, se corrige)
//
// Respaldo: antes de escribir, vuelca el estado previo de los afectados a
// reset-tarjeta-backup.json (para poder revertir).
//
// Uso (DRY-RUN): DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/reset-tarjeta-sin-factura.ts
// Uso (APLICAR): ...mismo... scripts/reset-tarjeta-sin-factura.ts --apply

import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) {
    console.log("No reconozco prod (falta ep-shy-morning en DATABASE_URL). Aborto.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Modo: ${APPLY ? "APPLY (escribe en PROD)" : "DRY-RUN"}\n`);

  const afectados = await prisma.bankMovement.findMany({
    where: { status: "sin_factura", category: "compra_tarjeta" },
    select: { id: true, date: true, amount: true, description: true, status: true, category: true,
      payments: { select: { id: true } } },
    orderBy: { date: "desc" },
  });

  // Helper: ¿el pago cubre el monto completo (±$1)?
  const cubierta = (m: typeof afectados[number]) =>
    m.payments.reduce((s, p) => s + p.amountApplied, 0) >= Math.abs(m.amount) - 1;

  const aCola = afectados.filter((m) => m.payments.length === 0); // -> sin_asignar
  const conPago = afectados.filter((m) => m.payments.length > 0);
  const aConciliado = conPago.filter(cubierta); // -> conciliado (cubierta full)
  const aParcial = conPago.filter((m) => !cubierta(m)); // -> parcial (pago no cubre todo)

  console.log(`Movimientos compra_tarjeta en sin_factura: ${afectados.length}`);
  console.log(`  -> a "sin_asignar" (vuelven a la cola, sin imputación): ${aCola.length}`);
  console.log(`  -> a "conciliado"  (pago cubre el total):               ${aConciliado.length}`);
  console.log(`  -> a "parcial"     (tiene pago pero no cubre todo):     ${aParcial.length}\n`);

  console.log("=== Volverán a la cola (sin_asignar) ===");
  for (const m of aCola) console.log(`  ${m.date.toISOString().slice(0,10)}  ${String(m.amount).padStart(11)}  ${m.description}`);
  if (aConciliado.length) {
    console.log("\n=== Pasan a conciliado (pago cubre el total) ===");
    for (const m of aConciliado) console.log(`  ${m.date.toISOString().slice(0,10)}  ${String(m.amount).padStart(11)}  ${m.description}`);
  }
  if (aParcial.length) {
    console.log("\n=== Pasan a parcial (pago no cubre todo — revisar saldo) ===");
    for (const m of aParcial) console.log(`  ${m.date.toISOString().slice(0,10)}  ${String(m.amount).padStart(11)}  ${m.description}`);
  }

  if (!APPLY) { console.log("\nDRY-RUN. Pasar --apply para escribir. (Se hará respaldo antes.)"); await prisma.$disconnect(); return; }

  // Respaldo del estado previo (para revertir si hace falta).
  writeFileSync("reset-tarjeta-backup.json",
    JSON.stringify(afectados.map((m) => ({ id: m.id, status: m.status, category: m.category })), null, 2), "utf8");
  console.log("\nRespaldo escrito: reset-tarjeta-backup.json");

  const r1 = await prisma.bankMovement.updateMany({
    where: { id: { in: aCola.map((m) => m.id) } },
    data: { status: "sin_asignar" },
  });
  const r2 = aConciliado.length
    ? await prisma.bankMovement.updateMany({
        where: { id: { in: aConciliado.map((m) => m.id) } },
        data: { status: "conciliado" },
      })
    : { count: 0 };
  const r3 = aParcial.length
    ? await prisma.bankMovement.updateMany({
        where: { id: { in: aParcial.map((m) => m.id) } },
        data: { status: "parcial" },
      })
    : { count: 0 };

  console.log(`LISTO. -> sin_asignar: ${r1.count}  -> conciliado: ${r2.count}  -> parcial: ${r3.count}`);
  console.log("Próximo paso sugerido: correr 'Auto-conciliar pendientes' en la app para linkear las que tienen factura.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
