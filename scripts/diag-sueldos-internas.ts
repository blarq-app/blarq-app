// Diagnóstico SOLO LECTURA: ¿por qué aparecen "pocas" transferencias internas
// BLARQ↔BLARQ en la cuenta Sueldos?
//
// No escribe NADA. Solo cuenta y agrupa movimientos para entender:
//   - cuántos movimientos hay en cada cuenta y en qué estado
//   - cuántos ABONOS (plata que ENTRA) a Sueldos vienen del RUT de BLARQ
//   - cuántos de esos quedaron linkeados como "interno" y cuántos sueltos
//   - candidatos a interna (RUT BLARQ en la glosa) que NO se linkearon
//
// Corre contra .env.prod (la base que ve MJ en la app). Forzamos la carga de
// ese archivo para no tocar la base de desarrollo.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

// Forzamos la URL de PROD leyéndola de .env.prod. No usamos dotenv porque
// Prisma auto-carga .env (dev) y ganaría esa. Pasamos la URL explícita al
// cliente para que NO haya ambigüedad de a qué base apuntamos.
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

const BLARQ_RUT_DIGITS = "0772707339";

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

async function main() {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "??";
  console.log("Conectado a:", host);
  console.log("=".repeat(70));

  const accounts = await prisma.bankAccount.findMany({
    orderBy: { role: "asc" },
  });

  for (const acc of accounts) {
    console.log(`\nCUENTA: ${acc.alias}  (role=${acc.role}, n°=${acc.accountNumber})`);
    console.log("-".repeat(70));

    const movs = await prisma.bankMovement.findMany({
      where: { bankAccountId: acc.id },
      select: {
        date: true,
        description: true,
        amount: true,
        type: true,
        category: true,
        status: true,
        counterpartyRut: true,
        counterpartyName: true,
        internalTransferToId: true,
      },
      orderBy: { date: "desc" },
    });

    console.log(`Total movimientos: ${movs.length}`);

    // Por estado
    const byStatus = new Map<string, number>();
    for (const m of movs) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
    console.log("Por estado:", Object.fromEntries(byStatus));

    // Por categoría
    const byCat = new Map<string, number>();
    for (const m of movs) {
      const k = m.category ?? "(null)";
      byCat.set(k, (byCat.get(k) ?? 0) + 1);
    }
    console.log("Por categoría:", Object.fromEntries(byCat));

    // Abonos (entra plata) vs cargos (sale plata)
    const abonos = movs.filter((m) => m.amount > 0);
    const cargos = movs.filter((m) => m.amount < 0);
    console.log(
      `Abonos (entra): ${abonos.length} mov, ${fmt(abonos.reduce((s, m) => s + m.amount, 0))}`
    );
    console.log(
      `Cargos (sale):  ${cargos.length} mov, ${fmt(cargos.reduce((s, m) => s + m.amount, 0))}`
    );

    // ¿Cuántos movimientos llevan el RUT de BLARQ en la glosa? (candidatos a interna)
    const blarqRut = movs.filter((m) => m.counterpartyRut?.startsWith(BLARQ_RUT_DIGITS));
    const blarqLinked = blarqRut.filter((m) => m.internalTransferToId);
    const blarqUnlinked = blarqRut.filter((m) => !m.internalTransferToId);
    console.log(
      `\n  Con RUT BLARQ en glosa (candidatos a interna): ${blarqRut.length}`
    );
    console.log(`    → linkeados como interna: ${blarqLinked.length}`);
    console.log(`    → SUELTOS (no linkeados): ${blarqUnlinked.length}`);

    // Movimientos marcados "interno"
    const internos = movs.filter((m) => m.status === "interno");
    console.log(`  Marcados status="interno": ${internos.length}`);

    // Los candidatos a interna que quedaron SUELTOS — el corazón del problema
    if (blarqUnlinked.length > 0) {
      console.log(`\n  >>> Candidatos a interna SIN linkear (esto es lo raro):`);
      for (const m of blarqUnlinked) {
        console.log(
          `      ${m.date.toISOString().slice(0, 10)}  ${fmt(m.amount).padStart(14)}  [${m.status}]  ${m.description.slice(0, 45)}`
        );
      }
    }
  }

  // ── Cruce global: abonos de Sueldos sin RUT BLARQ pero que podrían ser
  //    fondeo interno mal-glosado (entra plata grande sin glosa de BLARQ) ──
  console.log("\n" + "=".repeat(70));
  console.log("ABONOS a Sueldos agrupados por contraparte (de dónde entra la plata):");
  const sueldos = accounts.find((a) => a.role === "salary_fund");
  if (sueldos) {
    const abonosSueldos = await prisma.bankMovement.findMany({
      where: { bankAccountId: sueldos.id, amount: { gt: 0 } },
      select: {
        date: true,
        amount: true,
        description: true,
        counterpartyName: true,
        counterpartyRut: true,
        status: true,
      },
      orderBy: { date: "desc" },
    });
    for (const m of abonosSueldos) {
      const rutTag = m.counterpartyRut?.startsWith(BLARQ_RUT_DIGITS) ? "BLARQ" : (m.counterpartyRut ?? "sin-rut");
      console.log(
        `  ${m.date.toISOString().slice(0, 10)}  ${fmt(m.amount).padStart(14)}  [${m.status.padEnd(11)}] rut=${String(rutTag).padEnd(12)} ${m.description.slice(0, 40)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
