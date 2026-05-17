/**
 * Rellena el campo balanceAfter de los BankMovement que ya existían antes
 * de que el importador empezara a calcularlo (movimientos cargados hasta
 * el 2026-05-17).
 *
 * POR QUÉ es crítico: el importador ahora deduplica por
 * (cuenta, fecha, monto, balanceAfter). Si los movimientos viejos tienen
 * balanceAfter en null, el primer reimport de una cartola NO los reconoce
 * como existentes y los vuelve a insertar — duplicando todo. Este backfill
 * tiene que correr ANTES del primer reimport.
 *
 * Uso:
 *   npx tsx scripts/backfill-balance-after.ts [carpeta-cartolas]            (dry-run)
 *   npx tsx scripts/backfill-balance-after.ts [carpeta-cartolas] --apply    (escribe)
 *
 * Por defecto lee ~/Downloads. Apunta a la BD del DATABASE_URL del entorno
 * (el script imprime el host para que se vea si es dev o prod).
 *
 * Lógica:
 *   - Parsea las cartolas, una por n° de cartola (prefiere la Histórica).
 *   - Arma el set esperado de movimientos con su balanceAfter.
 *   - Agrupa por (fecha, monto). El balanceAfter de cada movimiento es la
 *     llave; dentro de un grupo de movimientos idénticos el orden no
 *     importa: lo que dedup necesita es que el CONJUNTO de balanceAfter
 *     del grupo quede asignado al conjunto de filas de la BD.
 *   - Asigna a cada BankMovement sin balanceAfter el valor que le toca.
 *   - Si un grupo no calza en cantidad (BD vs cartola), lo reporta y lo
 *     deja sin tocar — hay que reconciliar antes (reconcile-cartolas.ts).
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseCartolaSantander } from "../src/lib/banco/santanderParser";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dir = args.find((a) => !a.startsWith("--")) || join(homedir(), "Downloads");

function dbHost() {
  const url = process.env.DATABASE_URL || "";
  const m = url.match(/@([^/:]+)/);
  return m ? m[1] : "(desconocido)";
}

async function main() {
  console.log(`BD destino: ${dbHost()}`);
  console.log(`Modo: ${apply ? "APPLY (escribe)" : "dry-run (no escribe)"}\n`);

  // ── 1. Parsear cartolas, una por n° de cartola (prefiere Histórica) ──
  const files = readdirSync(dir).filter(
    (f) => f.startsWith("Cartola") && f.endsWith(".xlsx")
  );
  if (files.length === 0) {
    console.log(`No se encontraron archivos Cartola*.xlsx en ${dir}`);
    return;
  }

  type CartInfo = {
    isHistorica: boolean;
    movements: { date: Date; amount: number; balanceAfter: number }[];
  };
  const byAccount = new Map<string, Map<string, CartInfo>>();

  for (const f of files.sort()) {
    let parsed;
    try {
      parsed = parseCartolaSantander(readFileSync(join(dir, f)));
    } catch (e) {
      console.log(`  ⚠️  ${f}: no se pudo parsear — ${(e as Error).message}`);
      continue;
    }
    const isHistorica = f.startsWith("CartolaHist");
    if (!byAccount.has(parsed.accountNumber)) byAccount.set(parsed.accountNumber, new Map());
    const accMap = byAccount.get(parsed.accountNumber)!;
    const prev = accMap.get(parsed.cartolaNumber);
    if (prev && prev.isHistorica && !isHistorica) continue;
    accMap.set(parsed.cartolaNumber, {
      isHistorica,
      movements: parsed.movements.map((m) => ({
        date: m.date,
        amount: m.amount,
        balanceAfter: m.balanceAfter,
      })),
    });
  }

  let totalUpdated = 0;
  let totalAmbiguous = 0;
  let totalAlready = 0;
  let totalOutOfRange = 0;

  // ── 2. Por cuenta, asignar balanceAfter a las filas de la BD ─────────
  for (const [accountNumber, accMap] of byAccount) {
    console.log(`\n════ Cuenta ${accountNumber} ════`);
    const account = await prisma.bankAccount.findUnique({ where: { accountNumber } });
    if (!account) {
      console.log(`  ⚠️  Cuenta no registrada en la app. Salto.`);
      continue;
    }

    // Set esperado agrupado por (fecha|monto) → lista de balanceAfter.
    // minDate/maxDate = rango de fechas que cubren las cartolas. Los
    // movimientos de la BD fuera de ese rango son historia anterior a las
    // cartolas cargadas — no hay con qué cruzarlos, se dejan sin tocar.
    const expected = new Map<string, number[]>();
    let minDate = "9999-99-99";
    let maxDate = "0000-00-00";
    const cartNums = [...accMap.keys()].sort((a, b) => Number(a) - Number(b));
    for (const cn of cartNums) {
      for (const m of accMap.get(cn)!.movements) {
        const fecha = m.date.toISOString().slice(0, 10);
        const key = `${fecha}|${Math.round(m.amount)}`;
        if (!expected.has(key)) expected.set(key, []);
        expected.get(key)!.push(m.balanceAfter);
        if (fecha < minDate) minDate = fecha;
        if (fecha > maxDate) maxDate = fecha;
      }
    }

    // Filas de la BD agrupadas igual, en orden de creación.
    const movs = await prisma.bankMovement.findMany({
      where: { bankAccountId: account.id },
      select: { id: true, date: true, amount: true, balanceAfter: true },
      orderBy: { createdAt: "asc" },
    });
    const dbGroups = new Map<string, { id: string; balanceAfter: number | null }[]>();
    for (const m of movs) {
      const key = `${m.date.toISOString().slice(0, 10)}|${Math.round(m.amount)}`;
      if (!dbGroups.has(key)) dbGroups.set(key, []);
      dbGroups.get(key)!.push({ id: m.id, balanceAfter: m.balanceAfter });
    }

    let updated = 0;
    let ambiguous = 0;
    let already = 0;
    let outOfRange = 0;

    for (const [key, dbRows] of dbGroups) {
      const fecha = key.split("|")[0];
      // Fuera del rango de las cartolas: historia previa, sin cartola para
      // cruzar. Se deja con balanceAfter en null, sin alarma.
      if (fecha < minDate || fecha > maxDate) {
        outOfRange += dbRows.length;
        continue;
      }
      const expVals = expected.get(key) ?? [];
      if (expVals.length !== dbRows.length) {
        // Dentro del rango pero no calza en cantidad: ambiguo de verdad.
        // No tocamos. Reconciliar primero.
        const monto = key.split("|")[1];
        console.log(
          `  ⚠️  ${fecha} ${Number(monto).toLocaleString("es-CL")}: ` +
            `BD tiene ${dbRows.length}, cartola tiene ${expVals.length} — sin tocar.`
        );
        ambiguous += dbRows.length;
        continue;
      }
      // Calza: asignar por índice (el orden dentro del grupo es indistinto
      // para la deduplicación; lo que importa es el conjunto).
      for (let i = 0; i < dbRows.length; i++) {
        if (dbRows[i].balanceAfter != null) {
          already++;
          continue;
        }
        if (apply) {
          await prisma.bankMovement.update({
            where: { id: dbRows[i].id },
            data: { balanceAfter: expVals[i] },
          });
        }
        updated++;
      }
    }

    console.log(
      `  Movimientos en la app: ${movs.length} · ` +
        `a rellenar: ${updated} · ya tenían: ${already} · ` +
        `fuera de rango de cartolas: ${outOfRange} · ambiguos (sin tocar): ${ambiguous}`
    );
    totalUpdated += updated;
    totalAmbiguous += ambiguous;
    totalAlready += already;
    totalOutOfRange += outOfRange;
  }

  console.log(
    `\n${apply ? "Actualizados" : "Se actualizarían"}: ${totalUpdated} · ` +
      `ya tenían balanceAfter: ${totalAlready} · ` +
      `fuera de rango (historia previa): ${totalOutOfRange} · ` +
      `ambiguos sin tocar: ${totalAmbiguous}`
  );
  if (totalAmbiguous > 0) {
    console.log(
      `\n⚠️  Hay ${totalAmbiguous} movimientos ambiguos. Correr reconcile-cartolas.ts ` +
        `y resolver las diferencias antes de dar el backfill por completo.`
    );
  }
  if (!apply && totalUpdated > 0) {
    console.log(`\nPara escribir: agregá --apply`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
