// PUNTO 2 frente B — completar el feed bancario: importa los movimientos de la
// Operativa 2025 que faltan en la app, desde las cartolas OFICIALES del Santander
// (~/Downloads/2025_Cartolas, formato Histórica de los 12 meses 0025-0036).
//
// CAUSA del hueco: el import original (`import-cartolas-huecos-2025.ts`) solo
// trajo Ene/Feb/Nov/Dic y SALTÓ mar-oct asumiéndolos completos — no lo estaban.
//
// Dedup: por (cuenta, fecha, monto, GLOSA normalizada), NO por balanceAfter.
// Motivo: balanceAfter es relativo a cada cartola (se recalcula por archivo) y no
// es comparable entre el import viejo y este → usarlo arriesga DUPLICAR los 1.170
// que ya están. La llave (fecha+monto+glosa) es estable y ya verificada (78 ausentes).
// Conservador: solo inserta movimientos cuya llave NO existe en la app (si el banco
// tuviera 2 idénticos y la app 1, no agrega el 2º — eso se revisa a mano si aparece).
//
// CANDADOS: solo prod (ep-shy-morning) · NO auto-concilia (status sin_asignar; la
// conciliación se corre aparte, paso siguiente) · idempotente · reporta cuántos del
// banco YA están (debe ser ~1.163) para evidenciar que no duplica.
// Dry-run por default. Escribe con --apply.
// Uso: DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.prod | cut -d= -f2-)" npx tsx scripts/importar-faltantes-operativa-2025.ts [--apply]

import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { prisma } from "../src/lib/prisma";
import { parseCartolaSantander, type ParsedMovement } from "../src/lib/banco/santanderParser";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const key = (acct: string, d: Date, amount: number, desc: string) => `${acct}|${ymd(d)}|${Math.round(amount)}|${norm(desc)}`;

const DIR = join(homedir(), "Downloads", "2025_Cartolas");
const OP_ACCT = "ba_op_blarq";

async function main() {
  if (!/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) { console.log("No reconozco prod. Aborto."); await prisma.$disconnect(); return; }

  // ── 1. parsear las 12 cartolas Operativa (89134595), dedup cross-cartola por llave ──
  const files = readdirSync(DIR).filter((f) => f.includes("000089134595") && f.endsWith(".xlsx"));
  const bank = new Map<string, ParsedMovement>();
  for (const f of files) {
    const p = parseCartolaSantander(readFileSync(join(DIR, f)));
    for (const m of p.movements) {
      if (!ymd(m.date).startsWith("2025")) continue; // solo 2025
      const k = key(OP_ACCT, m.date, m.amount, m.description);
      if (!bank.has(k)) bank.set(k, m); // primera aparición (overlaps de cartola colapsan)
    }
  }

  // ── 2. app: movs Operativa 2025 ──
  const appRaw = await prisma.bankMovement.findMany({ where: { bankAccountId: OP_ACCT },
    select: { date: true, amount: true, description: true } });
  const appKeys = new Set<string>();
  for (const m of appRaw) { if (ymd(m.date).startsWith("2025")) appKeys.add(key(OP_ACCT, m.date, m.amount, m.description)); }

  // ── 3. diferencia ──
  const toInsert: ParsedMovement[] = [];
  let yaEstan = 0;
  for (const [k, m] of bank) { if (appKeys.has(k)) yaEstan++; else toInsert.push(m); }

  // ── reporte ──
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Banco Operativa 2025 (cartolas oficiales, deduped): ${bank.size} movimientos`);
  console.log(`  de esos, YA están en la app: ${yaEstan}  →  A INSERTAR: ${toInsert.length} (${fmt(toInsert.reduce((s, m) => s + Math.abs(m.amount), 0))})`);
  console.log(`  (la app tiene ${appKeys.size} movs Operativa 2025; "ya están" alto ⇒ el dedup reconoce los existentes, no duplica)\n`);

  // por mes + tipo
  const byMonth = new Map<string, { n: number; cargo: number; abono: number; sum: number }>();
  for (const m of toInsert) { const mo = ymd(m.date).slice(0, 7); const e = byMonth.get(mo) ?? { n: 0, cargo: 0, abono: 0, sum: 0 }; e.n++; e.sum += Math.abs(m.amount); if (m.amount < 0) e.cargo++; else e.abono++; byMonth.set(mo, e); }
  console.log("A insertar por mes:");
  for (const [mo, e] of [...byMonth.entries()].sort()) console.log(`  ${mo}: ${String(e.n).padStart(3)} (${e.cargo} cargos / ${e.abono} abonos) · ${fmt(e.sum)}`);

  console.log(`\nDetalle (todos los que se insertarían):`);
  for (const m of toInsert.sort((a, b) => a.date.getTime() - b.date.getTime()))
    console.log(`  ${ymd(m.date)}  ${fmt(m.amount).padStart(14)}  ${m.amount < 0 ? "cargo" : "abono"}  "${(m.description ?? "").slice(0, 46)}"`);

  if (!APPLY) { console.log(`\n[DRY-RUN] No se escribió nada. --apply para insertar (status sin_asignar, sin auto-conciliar).`); await prisma.$disconnect(); return; }

  // ── aplicar ──
  let created = 0;
  for (const m of toInsert) {
    // doble-check idempotente contra prod en vivo (por si corre dos veces)
    const exists = await prisma.bankMovement.findFirst({ where: { bankAccountId: OP_ACCT, date: m.date, amount: m.amount, description: m.description }, select: { id: true } });
    if (exists) continue;
    await prisma.bankMovement.create({ data: {
      bankAccountId: OP_ACCT, date: m.date, amount: m.amount, description: m.description,
      type: m.type, balanceAfter: m.balanceAfter, externalRef: m.externalRef,
      counterpartyName: m.counterpartyName ?? null, counterpartyRut: m.counterpartyRut ?? null,
      status: "sin_asignar",
    } });
    created++;
  }
  const totalOp2025 = await prisma.bankMovement.count({ where: { bankAccountId: OP_ACCT, date: { gte: new Date("2025-01-01"), lt: new Date("2026-01-01") } } });
  console.log(`\nAPLICADO: ${created} movimientos insertados (status sin_asignar). Operativa 2025 ahora: ${totalOp2025} movs.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
