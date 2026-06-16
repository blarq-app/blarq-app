// Re-emparejado de transferencias internas BLARQ↔BLARQ que el detector del
// import nunca linkeó.
//
// CONTEXTO (ver diag-sueldos-internas.ts): el detector de internas (commit
// fd519b5, 2026-04-29) solo corre al importar una cartola y compara contra lo
// que YA estaba en la base, ±2 días, monto exacto opuesto. No re-escanea lo
// viejo. Resultado en prod: de 29 transferencias BLARQ→Sueldos, 15 quedaron
// bien linkeadas, 10 marcadas "interno" pero SIN unir a su gemela, y 4 ni
// siquiera detectadas (siguen "sin_asignar" / "Pendiente").
//
// Este script corre la MISMA lógica del detector pero sobre los datos que ya
// existen: para cada movimiento con RUT de BLARQ en la glosa que todavía no
// está linkeado, busca su gemela en OTRA cuenta (monto exacto opuesto, fecha
// dentro de la ventana, también sin linkear) y los une: setea
// internalTransferToId en ambos + status="interno" + category="transfer_interno".
//
// SEGURIDAD:
//   - Default DRY-RUN: imprime los pares que armaría y NO escribe nada.
//     Para aplicar: `npx tsx scripts/reparear-transferencias-internas.ts --apply`
//   - Solo toca movimientos con RUT BLARQ sin linkear. No toca los 15 ya
//     bien emparejados ni nada que no sea una interna.
//   - Emparejado 1-a-1: una gemela usada no se reutiliza. Si hay ambigüedad
//     (dos candidatas con mismo monto y fecha), se reporta y NO se empareja.
//   - No mueve ningún total: cobrado/gastado/utilidad salen de facturas, no
//     del status de los movimientos (verificado en metrics.ts / fondoSueldos.ts).

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const BLARQ_RUT_DIGITS = "0772707339";
// Ventana de fecha: el detector original usa ±2 días. Lo mantenemos — las
// transferencias entre cuentas propias se asientan el mismo día o casi.
const WINDOW_DAYS = 2;

const prodUrl = readFileSync(".env.prod", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.replace(/^DATABASE_URL=/, "")
  .replace(/^["']|["']$/g, "")
  .trim();

if (!prodUrl || !prodUrl.includes("ep-shy-morning")) {
  throw new Error("No encontré la URL de prod (ep-shy-morning) en .env.prod");
}

const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}
function d(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main() {
  console.log(APPLY ? ">>> MODO APLICAR (escribe en prod)" : ">>> DRY-RUN (no escribe nada)");
  console.log("=".repeat(70));

  // Todos los movimientos con RUT BLARQ en la glosa, sin linkear todavía.
  const candidatos = await prisma.bankMovement.findMany({
    where: {
      counterpartyRut: { startsWith: BLARQ_RUT_DIGITS },
      internalTransferToId: null,
    },
    select: {
      id: true,
      bankAccountId: true,
      date: true,
      amount: true,
      status: true,
      category: true,
      description: true,
    },
    orderBy: { date: "asc" },
  });

  console.log(`Candidatos sin linkear (RUT BLARQ): ${candidatos.length}`);

  const usados = new Set<string>();
  const pares: { a: (typeof candidatos)[0]; b: (typeof candidatos)[0]; deltaDias: number }[] = [];
  const ambiguos: (typeof candidatos)[0][] = [];
  const huerfanos: (typeof candidatos)[0][] = [];

  for (const mov of candidatos) {
    if (usados.has(mov.id)) continue;

    const desde = new Date(mov.date);
    desde.setDate(desde.getDate() - WINDOW_DAYS);
    const hasta = new Date(mov.date);
    hasta.setDate(hasta.getDate() + WINDOW_DAYS);

    // Gemela: otra cuenta, monto exacto opuesto, dentro de la ventana, no usada.
    const gemelas = candidatos.filter(
      (c) =>
        !usados.has(c.id) &&
        c.id !== mov.id &&
        c.bankAccountId !== mov.bankAccountId &&
        c.amount === -mov.amount &&
        c.date >= desde &&
        c.date <= hasta
    );

    if (gemelas.length === 0) {
      huerfanos.push(mov);
      continue;
    }
    if (gemelas.length > 1) {
      // Ambiguo: misma plata, misma ventana, no podemos elegir con certeza.
      ambiguos.push(mov);
      continue;
    }

    const gemela = gemelas[0];
    usados.add(mov.id);
    usados.add(gemela.id);
    const deltaDias = Math.round(
      (gemela.date.getTime() - mov.date.getTime()) / (1000 * 60 * 60 * 24)
    );
    pares.push({ a: mov, b: gemela, deltaDias });
  }

  console.log(`\nPares a emparejar: ${pares.length}`);
  console.log("-".repeat(70));
  for (const { a, b, deltaDias } of pares) {
    const signo = a.amount < 0 ? a : b; // el cargo (sale)
    const abono = a.amount < 0 ? b : a; // el abono (entra)
    console.log(
      `  ${d(signo.date)}  ${fmt(signo.amount).padStart(14)} (sale) ↔ ${fmt(abono.amount).padStart(13)} (entra)` +
        `  Δ${deltaDias}d  [${signo.status}/${abono.status}]`
    );
  }

  if (ambiguos.length > 0) {
    console.log(`\n⚠ Ambiguos (NO se emparejan, revisar a mano): ${ambiguos.length}`);
    for (const m of ambiguos) {
      console.log(`  ${d(m.date)}  ${fmt(m.amount).padStart(14)}  ${m.description.slice(0, 40)}`);
    }
  }
  if (huerfanos.length > 0) {
    console.log(`\n⚠ Sin gemela en ventana ±${WINDOW_DAYS}d (NO se tocan): ${huerfanos.length}`);
    for (const m of huerfanos) {
      console.log(`  ${d(m.date)}  ${fmt(m.amount).padStart(14)}  ${m.description.slice(0, 40)}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: no se escribió nada. Para aplicar: --apply`);
    return;
  }

  // Aplicar: unir cada par en una transacción.
  let aplicados = 0;
  for (const { a, b } of pares) {
    await prisma.$transaction([
      prisma.bankMovement.update({
        where: { id: a.id },
        data: { internalTransferToId: b.id, status: "interno", category: "transfer_interno" },
      }),
      prisma.bankMovement.update({
        where: { id: b.id },
        data: { internalTransferToId: a.id, status: "interno", category: "transfer_interno" },
      }),
    ]);
    aplicados++;
  }
  console.log(`\n✓ Emparejados y etiquetados: ${aplicados} pares (${aplicados * 2} movimientos).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
