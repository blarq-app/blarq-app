// SOLO LECTURA: ¿el universo de transferencias internas BLARQ es completo?
// Mira el rango de fechas de cada cuenta, si hay meses sin cartola, y lista
// TODAS las "Transf a/de BLARQ" mes a mes para ver si falta alguna época.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const BLARQ = "0772707339";
const prodUrl = readFileSync(".env.prod", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  ?.replace(/^DATABASE_URL=/, "").replace(/^["']|["']$/g, "").trim();
if (!prodUrl?.includes("ep-shy-morning")) throw new Error("falta URL prod");
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const accounts = await prisma.bankAccount.findMany();
  for (const acc of accounts) {
    const agg = await prisma.bankMovement.aggregate({
      where: { bankAccountId: acc.id },
      _min: { date: true }, _max: { date: true }, _count: true,
    });
    console.log(`\n${acc.alias} (${acc.role}): ${agg._count} movs, desde ${agg._min.date?.toISOString().slice(0,10)} hasta ${agg._max.date?.toISOString().slice(0,10)}`);

    // Movs por mes — para ver huecos de cartola
    const movs = await prisma.bankMovement.findMany({
      where: { bankAccountId: acc.id }, select: { date: true },
    });
    const porMes = new Map<string, number>();
    for (const m of movs) {
      const k = m.date.toISOString().slice(0, 7);
      porMes.set(k, (porMes.get(k) ?? 0) + 1);
    }
    console.log("  movs por mes:", Object.fromEntries([...porMes.entries()].sort()));
  }

  // TODAS las transferencias BLARQ, mes a mes, las dos cuentas
  console.log("\n" + "=".repeat(60));
  console.log("TODAS las 'Transf a/de BLARQ' por mes (las dos cuentas):");
  const blarq = await prisma.bankMovement.findMany({
    where: { counterpartyRut: { startsWith: BLARQ } },
    select: { date: true, amount: true, bankAccountId: true },
    orderBy: { date: "asc" },
  });
  const porMes = new Map<string, { n: number; suma: number }>();
  for (const m of blarq) {
    const k = m.date.toISOString().slice(0, 7);
    const e = porMes.get(k) ?? { n: 0, suma: 0 };
    e.n++; e.suma += Math.abs(m.amount);
    porMes.set(k, e);
  }
  for (const [mes, e] of [...porMes.entries()].sort()) {
    console.log(`  ${mes}: ${e.n} movs (${e.n / 2} transferencias), ${fmt(e.suma / 2)}`);
  }
  console.log(`\nTOTAL movs con RUT BLARQ: ${blarq.length}  →  ${blarq.length / 2} transferencias`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
