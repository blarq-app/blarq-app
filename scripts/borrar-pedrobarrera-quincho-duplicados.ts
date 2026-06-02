// Borra los 14 registros "Pedro Barrera" sin_respaldo del Quincho La Llaveria
// que DUPLICAN a la factura real JPB f173.
//
// Contexto (ronda 42, confirmado por MJ 2026-06-01): en la migración (ronda 36)
// creé 14 Invoice sin_respaldo de mano de obra de Pedro Barrera en el Quincho,
// tratándolo como maestro sin factura. Pero JPB le hizo a MJ la factura real
// JPB f173 que cubre ESE trabajo → el gasto del Quincho estaba contado dos veces
// ($2.935.000 de más). MJ confirma: los sin_respaldo sobran, queda JPB f173.
//
// Qué hace:
//   1. Devuelve a "sin_asignar" las 14 transferencias que estaban enganchadas
//      (para que MJ las reasigne a mano a JPB f173 — eso es trabajo de ella).
//   2. Borra los 14 Invoice sin_respaldo (cascade borra sus InvoicePayment).
// NO toca JPB f173 ni ningún otro registro.
//
// Efecto en números: el gasto del Quincho BAJA $2.935.000 (se corrige el doble
// conteo). Es a propósito y es el punto del cambio.
//
// Dry-run por defecto. --apply para escribir.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/borrar-pedrobarrera-quincho-duplicados.ts [--apply]

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const env = /ep-shy-morning/.test(url) ? "prod" : "otro";
  console.log(`borrar-pedrobarrera-quincho — ${APPLY ? "APPLY" : "DRY-RUN"} | ${env}\n`);
  if (env !== "prod") { console.log("No reconozco prod (ep-shy-morning). Aborto."); await prisma.$disconnect(); return; }

  const proj = await prisma.project.findFirst({ where: { name: { contains: "Quincho" } }, select: { id: true, name: true } });
  if (!proj) { console.log("No encontré el Quincho. Aborto."); await prisma.$disconnect(); return; }

  // SCOPE ESTRICTO: recibidas sin_respaldo de Pedro Barrera en el Quincho.
  const recs = await prisma.invoice.findMany({
    where: { projectId: proj.id, type: "recibida", origin: "sin_respaldo", businessName: { contains: "Pedro Barrera", mode: "insensitive" } },
    select: { id: true, totalAmount: true, status: true, payments: { select: { id: true, bankMovementId: true } } },
  });

  // candado: ninguna NC debe apuntar a estos registros
  const ids = recs.map((r) => r.id);
  const ncs = await prisma.invoice.count({ where: { appliedToInvoiceId: { in: ids } } });
  if (ncs > 0) { console.log(`ABORTO: ${ncs} notas de crédito apuntan a estos registros. Revisar a mano.`); await prisma.$disconnect(); return; }

  const movIds = [...new Set(recs.flatMap((r) => r.payments.map((p) => p.bankMovementId)))];
  const total = recs.reduce((s, r) => s + r.totalAmount, 0);
  console.log(`A borrar: ${recs.length} registros Pedro Barrera sin_respaldo · ${fmt(total)}`);
  console.log(`Transferencias a liberar (→ sin_asignar): ${movIds.length}`);
  console.log(`(JPB f173 y cualquier otra factura NO se tocan.)`);

  if (!APPLY) { console.log(`\n(dry-run — no se escribió nada. --apply para escribir.)`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  // 1. liberar las transferencias (antes de borrar; el mov no se borra en cascade)
  for (const movId of movIds) await prisma.bankMovement.update({ where: { id: movId }, data: { status: "sin_asignar" } });
  // 2. borrar los registros (cascade borra sus InvoicePayment)
  const del = await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nEscritos: ${del.count} registros borrados, ${movIds.length} transferencias → sin_asignar.`);

  // ── verificación ──
  const quedan = await prisma.invoice.count({ where: { projectId: proj.id, type: "recibida", origin: "sin_respaldo", businessName: { contains: "Pedro Barrera", mode: "insensitive" } } });
  console.log(`Verificación — registros Pedro Barrera sin_respaldo en Quincho restantes (debe ser 0): ${quedan}`);
  const movs = await prisma.bankMovement.findMany({ where: { id: { in: movIds } }, select: { status: true } });
  console.log(`Transferencias liberadas en estado: ${[...new Set(movs.map((m) => m.status))].join(", ")}`);
  const jpb = await prisma.invoice.findFirst({ where: { projectId: proj.id, businessName: { contains: "JPB" } }, select: { folioNumber: true, status: true, totalAmount: true } });
  console.log(`Control JPB f173 (intacta): f${jpb?.folioNumber} ${fmt(jpb?.totalAmount ?? 0)} [${jpb?.status}]`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
