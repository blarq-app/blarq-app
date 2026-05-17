/**
 * READ-ONLY. Reconcilia los movimientos bancarios de la app (BankMovement)
 * contra las cartolas Santander en disco.
 *
 * Para qué sirve: verificar ANTES y DESPUÉS de un import/reimport que la
 * base tiene exactamente los movimientos de las cartolas — ni de menos
 * (movimientos perdidos) ni de más (duplicados).
 *
 * Uso:
 *   npx tsx scripts/reconcile-cartolas.ts [carpeta-cartolas]
 *
 * Por defecto lee ~/Downloads. Toma todos los archivos Cartola*.xlsx.
 *
 * Lógica:
 *   - Parsea cada cartola y la agrupa por cuenta.
 *   - Para cada (cuenta, n° cartola) se queda con UNA: prefiere la
 *     Histórica (mes cerrado, definitiva) sobre la Provisoria.
 *   - Concatena los movimientos de todas las cartolas → set esperado.
 *   - Compara contra BankMovement de la BD por (fecha, monto), contando
 *     multiplicidad. Reporta faltantes y sobrantes.
 *   - Reporta también cuántos BankMovement tienen balanceAfter en null
 *     (pendientes de backfill).
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseCartolaSantander } from "../src/lib/banco/santanderParser";

const dir = process.argv[2] || join(homedir(), "Downloads");

function fmt(n: number) {
  return n.toLocaleString("es-CL");
}

async function main() {
  // ── 1. Leer y parsear todas las cartolas del directorio ──────────────
  const files = readdirSync(dir).filter(
    (f) => f.startsWith("Cartola") && f.endsWith(".xlsx")
  );
  if (files.length === 0) {
    console.log(`No se encontraron archivos Cartola*.xlsx en ${dir}`);
    return;
  }
  console.log(`Leyendo ${files.length} cartolas de ${dir}\n`);

  // Por cuenta → por n° de cartola, nos quedamos con la mejor versión.
  type CartolaInfo = {
    isHistorica: boolean;
    movements: { date: Date; amount: number }[];
  };
  const byAccount = new Map<string, Map<string, CartolaInfo>>();

  for (const f of files.sort()) {
    let parsed;
    try {
      parsed = parseCartolaSantander(readFileSync(join(dir, f)));
    } catch (e) {
      console.log(`  ⚠️  ${f}: no se pudo parsear — ${(e as Error).message}`);
      continue;
    }
    const isHistorica = f.startsWith("CartolaHist");
    if (!byAccount.has(parsed.accountNumber)) {
      byAccount.set(parsed.accountNumber, new Map());
    }
    const accMap = byAccount.get(parsed.accountNumber)!;
    const prev = accMap.get(parsed.cartolaNumber);
    // Preferimos la Histórica. Si ya hay una Histórica, no la pisamos.
    if (prev && prev.isHistorica && !isHistorica) continue;
    accMap.set(parsed.cartolaNumber, {
      isHistorica,
      movements: parsed.movements.map((m) => ({ date: m.date, amount: m.amount })),
    });
  }

  // ── 2. Por cada cuenta, comparar set esperado vs BD ──────────────────
  for (const [accountNumber, accMap] of byAccount) {
    console.log(`\n════ Cuenta ${accountNumber} ════`);

    const account = await prisma.bankAccount.findUnique({
      where: { accountNumber },
    });
    if (!account) {
      console.log(`  ⚠️  La cuenta ${accountNumber} no está registrada en la app. Salto.`);
      continue;
    }

    // Set esperado: concatenar movimientos de todas las cartolas elegidas.
    // Guardamos también el rango de fechas que cubren las cartolas — la
    // comparación de faltantes/sobrantes solo tiene sentido dentro de ese
    // rango. Movimientos de la app fuera del rango son historia anterior
    // a las cartolas cargadas, no duplicados.
    const cartolaKeys = new Map<string, number>();
    let expectedCount = 0;
    let minDate = "9999-99-99";
    let maxDate = "0000-00-00";
    const cartNums = [...accMap.keys()].sort((a, b) => Number(a) - Number(b));
    for (const cn of cartNums) {
      const info = accMap.get(cn)!;
      for (const m of info.movements) {
        const fecha = m.date.toISOString().slice(0, 10);
        const key = `${fecha}|${Math.round(m.amount)}`;
        cartolaKeys.set(key, (cartolaKeys.get(key) ?? 0) + 1);
        expectedCount++;
        if (fecha < minDate) minDate = fecha;
        if (fecha > maxDate) maxDate = fecha;
      }
    }
    console.log(
      `  Cartolas: ${cartNums.map((c) => `#${c}${accMap.get(c)!.isHistorica ? "H" : "P"}`).join(" ")}`
    );
    console.log(`  Período cubierto: ${minDate} → ${maxDate}`);

    // Set de la BD. Separamos los movimientos dentro del rango de cartolas
    // de los de fuera (historia más vieja, sin cartola para cruzar).
    const movs = await prisma.bankMovement.findMany({
      where: { bankAccountId: account.id },
      select: { date: true, amount: true, balanceAfter: true },
    });
    const dbKeys = new Map<string, number>();
    let nullBalance = 0;
    let outOfRange = 0;
    for (const m of movs) {
      const fecha = m.date.toISOString().slice(0, 10);
      if (m.balanceAfter == null) nullBalance++;
      if (fecha < minDate || fecha > maxDate) {
        outOfRange++;
        continue;
      }
      const key = `${fecha}|${Math.round(m.amount)}`;
      dbKeys.set(key, (dbKeys.get(key) ?? 0) + 1);
    }

    console.log(`  Movimientos esperados (cartolas):  ${expectedCount}`);
    console.log(`  Movimientos en la app (total):     ${movs.length}`);
    console.log(`  · dentro del período de cartolas:  ${movs.length - outOfRange}`);
    console.log(`  · fuera (historia previa, no es duplicado): ${outOfRange}`);
    console.log(`  Con balanceAfter en null:          ${nullBalance}`);

    // Faltantes: en cartola, no (o de menos) en la app.
    const allKeys = new Set([...cartolaKeys.keys(), ...dbKeys.keys()]);
    let faltan = 0;
    let sobran = 0;
    const faltanLines: string[] = [];
    const sobranLines: string[] = [];
    for (const key of allKeys) {
      const inCart = cartolaKeys.get(key) ?? 0;
      const inDb = dbKeys.get(key) ?? 0;
      const [fecha, montoStr] = key.split("|");
      const monto = Number(montoStr);
      if (inCart > inDb) {
        faltan += inCart - inDb;
        faltanLines.push(
          `    ${fecha}  ${fmt(monto).padStart(14)}  (cartola:${inCart} app:${inDb})`
        );
      } else if (inDb > inCart) {
        sobran += inDb - inCart;
        sobranLines.push(
          `    ${fecha}  ${fmt(monto).padStart(14)}  (cartola:${inCart} app:${inDb})`
        );
      }
    }

    if (faltan === 0 && sobran === 0) {
      console.log(`  ✅ La app calza exactamente con las cartolas.`);
    } else {
      if (faltan > 0) {
        console.log(`\n  FALTAN en la app (${faltan}):`);
        faltanLines.sort().forEach((l) => console.log(l));
      }
      if (sobran > 0) {
        console.log(`\n  SOBRAN en la app — posibles duplicados (${sobran}):`);
        sobranLines.sort().forEach((l) => console.log(l));
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
