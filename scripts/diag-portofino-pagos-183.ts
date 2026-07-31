/**
 * ¿Dónde están los pagos de la factura 183 de Portofino?
 *
 * El Cuadro Resumen de la app muestra $50.605.618 de pagos (82%) mientras que
 * el Excel de MJ dice 100% pagado ($75.862.045). La diferencia es exactamente
 * la factura 183 ($25.256.427), que en la app figura "pendiente" y sin ningún
 * `InvoicePayment` asociado.
 *
 * Este script busca en el banco los movimientos que podrían ser esos pagos, con
 * los montos que MJ tiene anotados en su Excel, para ver si existen y a qué
 * están imputados hoy.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const url = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const f = (d: Date) => d.toISOString().slice(0, 10);

// Los montos que MJ tiene en su Cuadro Resumen contra la factura 183.
const BUSCADOS = [4597977, 5000000, 5000000, 4953540, 3000000, 2000000, 704910];

async function main() {
  console.log("HOST:", host);

  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 60 },
    select: { id: true, name: true, clientName: true, clientRut: true },
  });
  if (!p) throw new Error("no existe #60");
  console.log(`Proyecto #60 ${p.name} — cliente ${p.clientName} ${p.clientRut ?? "(sin RUT)"}`);

  const f183 = await prisma.invoice.findFirst({
    where: { projectId: p.id, type: "emitida", folioNumber: "183" },
    include: { payments: { include: { bankMovement: true } } },
  });
  console.log(
    `\nFactura 183: ${clp(f183?.totalAmount ?? 0)} c/IVA · estado ${f183?.status} · ${f183?.payments.length ?? 0} pagos asociados`
  );

  // ── Movimientos de INGRESO del banco desde abril, para ver los candidatos ──
  const ingresos = await prisma.bankMovement.findMany({
    where: { amount: { gt: 0 }, date: { gte: new Date("2026-04-15") } },
    orderBy: { date: "asc" },
    include: { payments: { include: { invoice: { select: { folioNumber: true, type: true } } } } },
  });
  console.log(`\n=== INGRESOS al banco desde el 15-04-26: ${ingresos.length} ===`);
  console.log("fecha | monto | descripción | proyecto | imputado a");
  for (const m of ingresos) {
    const imputado = m.payments.length
      ? m.payments.map((x) => `fact ${x.invoice?.folioNumber ?? "?"} ${clp(x.amountApplied)}`).join(" + ")
      : "— sin imputar —";
    console.log(
      [f(m.date), clp(m.amount), (m.description ?? "").slice(0, 46), m.projectId === p.id ? "PORTOFINO" : (m.projectId ?? "-"), imputado].join(" | ")
    );
  }

  // ── ¿Aparecen los montos que MJ anotó? ───────────────────────────────────
  console.log("\n=== ¿Existen en el banco los montos del Excel de MJ? ===");
  for (const monto of [...new Set(BUSCADOS)]) {
    const cands = await prisma.bankMovement.findMany({
      where: { amount: { gte: monto - 1, lte: monto + 1 }, date: { gte: new Date("2026-04-01") } },
      include: { payments: true },
    });
    console.log(
      `  ${clp(monto).padStart(13)}: ${cands.length} movimiento(s)` +
        (cands.length
          ? " → " + cands.map((c) => `${f(c.date)} "${(c.description ?? "").slice(0, 30)}" ${c.payments.length ? "ya imputado" : "SIN IMPUTAR"}`).join(" ; ")
          : "")
    );
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
