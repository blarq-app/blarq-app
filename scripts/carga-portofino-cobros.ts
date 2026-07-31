/**
 * Dos cosas sobre los cobros de Portofino (#60), tomadas del Cuadro Resumen
 * que MJ lleva en Excel (`V7 Cuadro Resumen_PORTOFINO.xlsx`):
 *
 *   1. El REPARTO de cada factura emitida entre conceptos. Las 4 facturas son
 *      combinadas (la clienta pidió un documento por todo) pero en la app
 *      estaban las 4 como 100% Obra, así que el Cuadro Resumen dejaba muebles
 *      y artefactos en 0%.
 *
 *   2. La IMPUTACIÓN de los pagos de la factura 183, que estaban en el banco
 *      sin asociar a nada. Son 6 transferencias de la clienta (cuenta
 *      0105112904) por $24.551.517. El séptimo pago del Excel ($704.910)
 *      todavía no está en el banco — MJ tiene que ingresar esa cartola — así
 *      que la 183 queda "parcial" hasta entonces.
 *
 * Los montos del reparto van CON IVA y suman el total de cada factura; el
 * script lo verifica y corta si alguna no cuadra.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9).
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const TOLERANCIA = 10; // pesos, por redondeos de IVA

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

// ── 1. Reparto por factura, leído del Cuadro Resumen de MJ ─────────────────
// (columnas OBRA / ART. COCINA / ART. SANITARIOS / MUEBLES de su planilla)
const REPARTOS: Record<string, { obra: number; muebles: number; cocina: number; sanitarios: number; iluminacion: number }> = {
  "158": { obra: 9_072_320, muebles: 6_752_585, cocina: 735_955, sanitarios: 2_176_244, iluminacion: 0 },
  "159": { obra: 18_339_253, muebles: 0, cocina: 0, sanitarios: 0, iluminacion: 0 },
  "164": { obra: 13_529_261, muebles: 0, cocina: 0, sanitarios: 0, iluminacion: 0 },
  "183": { obra: 20_658_450, muebles: 4_597_977, cocina: 0, sanitarios: 0, iluminacion: 0 },
};

// ── 2. Pagos de la factura 183 que están en el banco sin imputar ───────────
// Todos de la cuenta 0105112904 (la clienta). Se identifican por fecha + monto.
const PAGOS_183: { fecha: string; monto: number }[] = [
  { fecha: "2026-05-11", monto: 4_597_977 },
  { fecha: "2026-05-13", monto: 5_000_000 },
  { fecha: "2026-05-13", monto: 5_000_000 },
  { fecha: "2026-05-18", monto: 4_953_540 },
  { fecha: "2026-07-17", monto: 3_000_000 },
  { fecha: "2026-07-27", monto: 2_000_000 },
];

async function main() {
  console.log("HOST:", host, "| MODO:", APPLY ? "APLICAR" : "DRY-RUN");
  if (!host.includes("ep-shy-morning")) throw new Error("No es la base viva — PARAR");

  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 60 },
    select: { id: true, name: true },
  });
  if (!p) throw new Error("no existe #60");

  const facturas = await prisma.invoice.findMany({
    where: { projectId: p.id, type: "emitida" },
    orderBy: { issueDate: "asc" },
    include: { payments: true },
  });

  // ── Parte 1: repartos ────────────────────────────────────────────────────
  console.log("\n=== 1. REPARTO DE LAS FACTURAS ENTRE CONCEPTOS ===");
  console.log("folio | total | obra | muebles | cocina | sanitarios | iluminación | suma | ¿cuadra?");
  const aRepartir: { id: string; folio: string; datos: (typeof REPARTOS)[string] }[] = [];
  for (const inv of facturas) {
    const r = REPARTOS[inv.folioNumber ?? ""];
    if (!r) {
      console.log(`${inv.folioNumber} | ${clp(inv.totalAmount)} | (sin reparto definido — se deja como está)`);
      continue;
    }
    const suma = r.obra + r.muebles + r.cocina + r.sanitarios + r.iluminacion;
    const cuadra = Math.abs(suma - inv.totalAmount) <= TOLERANCIA;
    console.log(
      [inv.folioNumber, clp(inv.totalAmount), clp(r.obra), clp(r.muebles), clp(r.cocina),
       clp(r.sanitarios), clp(r.iluminacion), clp(suma), cuadra ? "sí" : `NO (dif ${clp(suma - inv.totalAmount)})`].join(" | ")
    );
    if (!cuadra) throw new Error(`El reparto de la factura ${inv.folioNumber} no cuadra con su total — PARAR`);
    aRepartir.push({ id: inv.id, folio: inv.folioNumber!, datos: r });
  }

  // ── Parte 2: pagos de la 183 ─────────────────────────────────────────────
  const f183 = facturas.find((i) => i.folioNumber === "183");
  if (!f183) throw new Error("no encontré la factura 183");
  console.log(`\n=== 2. PAGOS A IMPUTAR A LA FACTURA 183 (${clp(f183.totalAmount)}) ===`);
  console.log(`Ya imputados: ${f183.payments.length} · ${clp(f183.payments.reduce((s, x) => s + x.amountApplied, 0))}`);

  const usados = new Set<string>();
  const aImputar: { movId: string; fecha: Date; monto: number; descripcion: string }[] = [];
  for (const pago of PAGOS_183) {
    const cands = await prisma.bankMovement.findMany({
      where: {
        date: { gte: new Date(`${pago.fecha}T00:00:00Z`), lte: new Date(`${pago.fecha}T23:59:59Z`) },
        amount: { gte: pago.monto - 1, lte: pago.monto + 1 },
      },
      include: { payments: true },
    });
    const libre = cands.find((c) => !usados.has(c.id) && c.payments.length === 0);
    if (!libre) {
      throw new Error(
        `No encontré un movimiento libre del ${pago.fecha} por ${clp(pago.monto)} (candidatos: ${cands.length}) — PARAR`
      );
    }
    usados.add(libre.id);
    aImputar.push({ movId: libre.id, fecha: libre.date, monto: pago.monto, descripcion: libre.description ?? "" });
  }

  console.log("fecha | monto | descripción del banco");
  for (const x of aImputar) console.log(`${f(x.fecha)} | ${clp(x.monto)} | ${x.descripcion.slice(0, 44)}`);
  const totalImputar = aImputar.reduce((s, x) => s + x.monto, 0);
  const yaImputado = f183.payments.reduce((s, x) => s + x.amountApplied, 0);
  const quedaria = yaImputado + totalImputar;
  console.log(`\nSuma a imputar: ${clp(totalImputar)}`);
  console.log(`La 183 quedaría con ${clp(quedaria)} de ${clp(f183.totalAmount)} → falta ${clp(f183.totalAmount - quedaria)}`);
  console.log(`Estado de la factura: ${f183.status} → ${quedaria >= f183.totalAmount - TOLERANCIA ? "pagada" : "parcial"}`);

  if (totalImputar > f183.totalAmount + TOLERANCIA) {
    throw new Error("Los pagos suman MÁS que la factura — PARAR");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN: no se escribió nada. Correr con --apply.");
    return;
  }

  // ── Escritura ────────────────────────────────────────────────────────────
  await prisma.$transaction(
    async (tx) => {
      for (const r of aRepartir) {
        await tx.invoice.update({
          where: { id: r.id },
          data: {
            montoObra: r.datos.obra,
            montoMuebles: r.datos.muebles,
            artefactoCocina: r.datos.cocina,
            artefactoSanitario: r.datos.sanitarios,
            artefactoIluminacion: r.datos.iluminacion,
          },
        });
      }
      for (const x of aImputar) {
        await tx.invoicePayment.create({
          data: {
            bankMovementId: x.movId,
            invoiceId: f183.id,
            amountApplied: x.monto,
            autoMatched: false,
          },
        });
        // El movimiento pasa a estar imputado a este proyecto.
        await tx.bankMovement.update({
          where: { id: x.movId },
          data: { projectId: p.id },
        });
      }
      // La factura queda parcial (o pagada, si alcanzara).
      await tx.invoice.update({
        where: { id: f183.id },
        data: { status: quedaria >= f183.totalAmount - TOLERANCIA ? "pagada" : "parcial" },
      });
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  const control = await prisma.invoice.findMany({
    where: { projectId: p.id, type: "emitida" },
    orderBy: { issueDate: "asc" },
    include: { payments: true },
  });
  console.log("\n=== DESPUÉS ===");
  for (const i of control) {
    const pag = i.payments.reduce((s, x) => s + x.amountApplied, 0);
    console.log(
      `  ${i.folioNumber} ${clp(i.totalAmount)} · ${i.status} · pagos ${clp(pag)} · ` +
        `obra ${clp(i.montoObra ?? 0)} muebles ${clp(i.montoMuebles ?? 0)} cocina ${clp(i.artefactoCocina ?? 0)} sanit ${clp(i.artefactoSanitario ?? 0)}`
    );
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
