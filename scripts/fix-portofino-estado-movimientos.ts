/**
 * Repara el estado de los movimientos bancarios que quedaron imputados a la
 * factura 183 de Portofino pero siguieron diciendo "Pendiente".
 *
 * Qué pasó: `carga-portofino-cobros.ts` creó los `InvoicePayment` a mano y no
 * llamó al recálculo del estado. Desde el PR #333 el `status` de un
 * BankMovement es DERIVADO — lo decide `recomputeMovementStatus` en
 * `src/lib/banco/movementStatus.ts` — y ningún camino puede escribirlo por su
 * cuenta ni saltarse el recálculo. Este script hace lo que faltaba.
 *
 * Replica la lógica de ese módulo en vez de importarlo, porque el módulo trae
 * el `prisma` global que carga `.env` y acá se apunta a la viva a propósito
 * (§4.9). La lógica es corta y está espejada 1:1:
 *   - modo explícito (interno / neto_cero) → no se toca.
 *   - imputado cubre el monto (tolerancia $1) → conciliado.
 *   - hay algo imputado pero queda saldo → parcial.
 *   - nada imputado → se respeta el estado de reposo.
 *
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const TOLERANCIA = 1;

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const MODOS_EXPLICITOS = ["interno", "neto_cero"];

function statusDerivado(sumApplied: number, absAmount: number): string | null {
  if (sumApplied <= 0) return null;
  return sumApplied >= absAmount - TOLERANCIA ? "conciliado" : "parcial";
}

async function main() {
  console.log("HOST:", host, "| MODO:", APPLY ? "APLICAR" : "DRY-RUN");
  if (!host.includes("ep-shy-morning")) throw new Error("No es la base viva — PARAR");

  // Todos los movimientos imputados a facturas emitidas del proyecto #60:
  // así se repara cualquiera que haya quedado descolgado, no solo los 6.
  const movs = await prisma.bankMovement.findMany({
    where: {
      payments: { some: { invoice: { project: { numeroProyecto: 60 }, type: "emitida" } } },
    },
    select: {
      id: true, date: true, amount: true, status: true, description: true,
      payments: { select: { amountApplied: true, invoice: { select: { folioNumber: true } } } },
    },
    orderBy: { date: "asc" },
  });

  console.log(`\n${movs.length} movimientos imputados a facturas emitidas del #60`);
  console.log("fecha | monto | imputado | factura | estado ahora | estado correcto");

  const aCambiar: { id: string; de: string; a: string; etiqueta: string }[] = [];
  for (const m of movs) {
    const sum = m.payments.reduce((s, p) => s + p.amountApplied, 0);
    const folios = [...new Set(m.payments.map((p) => p.invoice?.folioNumber ?? "?"))].join("/");
    let correcto = m.status;
    if (MODOS_EXPLICITOS.includes(m.status)) {
      correcto = m.status; // no se toca
    } else {
      const derivado = statusDerivado(sum, Math.abs(m.amount));
      if (derivado) correcto = derivado;
      else if (m.status === "conciliado" || m.status === "parcial") correcto = "sin_asignar";
    }
    const cambia = correcto !== m.status;
    console.log(
      [m.date.toISOString().slice(0, 10), clp(m.amount), clp(sum), folios, m.status,
       cambia ? `→ ${correcto}` : "(ya está bien)"].join(" | ")
    );
    if (cambia) {
      aCambiar.push({
        id: m.id, de: m.status, a: correcto,
        etiqueta: `${m.date.toISOString().slice(0, 10)} ${clp(m.amount)}`,
      });
    }
  }

  console.log(`\n${aCambiar.length} movimientos a corregir.`);
  if (!APPLY) {
    console.log("DRY-RUN: no se escribió nada. Correr con --apply.");
    return;
  }

  for (const c of aCambiar) {
    await prisma.bankMovement.update({ where: { id: c.id }, data: { status: c.a } });
  }

  const control = await prisma.bankMovement.findMany({
    where: { id: { in: aCambiar.map((c) => c.id) } },
    select: { date: true, amount: true, status: true },
    orderBy: { date: "asc" },
  });
  console.log(`\n${aCambiar.length} corregidos:`);
  for (const c of control) {
    console.log(`  ${c.date.toISOString().slice(0, 10)} ${clp(c.amount)} → ${c.status}`);
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
