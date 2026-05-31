// Importa SOLO las cartolas de los meses que faltan en la app (huecos 2025):
// Operativa Ene/Feb/Nov + Sueldos Nov/Dic. Usa el parser de la app y la
// misma deduplicación por (cuenta, fecha, monto, balanceAfter). NO importa
// mar-oct (ya están + tienen 7 ambiguos que se romperían). Dry-run default.
// Sin auto-match: la conciliación se hace aparte (con Maxxa, paso 3).
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import { parseCartolaSantander } from "../src/lib/banco/santanderParser";

const APPLY = process.argv.includes("--apply");
const DIR = "/Users/mjblanco/Downloads/2025_Cartolas";
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
// 0025=Ene 0026=Feb 0035=Nov 0036=Nov(fin)+Dic(dedup) Operativa | 0001=Nov 0002=Dic Sueldos
const FILES = [
  "CartolaHistCtaCte-000089134595-0025-20260531.xlsx",
  "CartolaHistCtaCte-000089134595-0026-20260531.xlsx",
  "CartolaHistCtaCte-000089134595-0035-20260531.xlsx",
  "CartolaHistCtaCte-000089134595-0036-20260531.xlsx",
  "CartolaHistCtaCte-000099878916-0001-20260531.xlsx",
  "CartolaHistCtaCte-000099878916-0002-20260531.xlsx",
];

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  let totalNew = 0, totalDup = 0;
  for (const f of FILES) {
    const parsed = parseCartolaSantander(readFileSync(`${DIR}/${f}`));
    const acc = await prisma.bankAccount.findFirst({ where: { accountNumber: parsed.accountNumber } });
    if (!acc) { console.log(`  ${f}: cuenta ${parsed.accountNumber} NO existe en app — saltando`); continue; }
    let nuevos = 0, dups = 0; const sample: string[] = [];
    for (const m of parsed.movements) {
      const exists = await prisma.bankMovement.findFirst({ where: { bankAccountId: acc.id, date: m.date, amount: m.amount, balanceAfter: m.balanceAfter }, select: { id: true } });
      if (exists) { dups++; continue; }
      nuevos++;
      if (sample.length < 3) sample.push(`${ymd(m.date)} ${fmt(m.amount)} ${(m.description||"").slice(0,28)}`);
      if (APPLY) {
        await prisma.bankMovement.create({ data: { bankAccountId: acc.id, date: m.date, amount: m.amount, description: m.description, type: m.amount >= 0 ? "in" : "out", balanceAfter: m.balanceAfter, externalRef: m.externalRef, counterpartyName: m.counterpartyName ?? null, counterpartyRut: m.counterpartyRut ?? null, status: "sin_asignar" } });
      }
    }
    console.log(`  ${f.replace("CartolaHistCtaCte-","").replace("-20260531.xlsx","")} [${acc.alias}] ${ymd(parsed.movements[0]?.date)}→${ymd(parsed.movements[parsed.movements.length-1]?.date)}: nuevos ${nuevos} · ya estaban ${dups}` + (sample.length ? ` · ej: ${sample[0]}` : ""));
    totalNew += nuevos; totalDup += dups;
  }
  console.log(`\nTOTAL: nuevos ${totalNew} · ya estaban ${totalDup}`);
  if (!APPLY) console.log("(DRY-RUN — nada escrito. --apply para aplicar)");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
