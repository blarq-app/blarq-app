// Cierra los casos del pendiente 162 en la base: los sobrepagos que el
// proveedor devolvió, y la nota de crédito de Comercial Hispano que se partió
// entre una factura y un depósito.
//
// DRY-RUN por default. Escribe solo con --apply.
//
//   npx tsx scripts/fix-162-devoluciones.ts .env.prod          (dry-run)
//   npx tsx scripts/fix-162-devoluciones.ts .env.prod --apply  (escribe)
//
// NO usa `import "dotenv/config"`: eso carga `.env`, que apunta a la base VIEJA.
// El DATABASE_URL se lee del archivo que se pasa por argumento (§4.9).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
const url = readFileSync(envPath, "utf8")
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1]
  .trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);
const linea = (t: string) => console.log(`\n${"─".repeat(78)}\n${t}\n${"─".repeat(78)}`);

// Obras que este script toca. Su gastado NO puede moverse: lo que cambia es el
// estado y de dónde cuelga cada cosa, no la plata.
const OBRAS_A_VIGILAR = ["JNC-Vitacura", "Portofino"];

/**
 * Gastado de una obra con el mismo criterio que metrics.ts: suma de las
 * facturas recibidas, restando las notas de crédito (tipoDoc 61). No filtra por
 * status — por eso cambiar "anulada" a "pagada" no lo mueve, y por eso este
 * chequeo sirve como red de seguridad de que no se movió nada.
 */
async function gastadoDeObra(nombre: string): Promise<number> {
  const invs = await prisma.invoice.findMany({
    where: { project: { name: nombre }, type: "recibida" },
    select: { totalAmount: true, tipoDoc: true },
  });
  return invs.reduce(
    (s, i) => s + (i.tipoDoc === 61 ? -1 : 1) * i.totalAmount,
    0
  );
}

async function fotoDeControl(rotulo: string) {
  linea(`GASTADO POR OBRA — ${rotulo}`);
  const foto: Record<string, number> = {};
  for (const o of OBRAS_A_VIGILAR) {
    foto[o] = await gastadoDeObra(o);
    console.log(`  ${o.padEnd(16)} ${clp(foto[o])}`);
  }
  const pendientes = await prisma.bankMovement.count({
    where: { status: "sin_asignar" },
  });
  const parciales = await prisma.bankMovement.count({
    where: { status: "parcial" },
  });
  console.log(`  movimientos sin asignar: ${pendientes} · parciales: ${parciales}`);
  return { foto, pendientes, parciales };
}

// ── PARTE 1 — sobrepagos devueltos ────────────────────────────────────────
//
// Un pago que ya está conciliado a su factura pero al que le sobró plata, y esa
// plata volvió en un movimiento aparte. Se netean SOLO los sobrantes: la
// factura no se toca.
async function cerrarSobrepagos() {
  linea("1. SOBREPAGOS DEVUELTOS");

  const movs = await prisma.bankMovement.findMany({
    where: { payments: { some: {} } },
    select: {
      id: true,
      date: true,
      amount: true,
      counterpartyName: true,
      description: true,
      netZeroAmount: true,
      payments: { select: { amountApplied: true } },
    },
  });

  let cerrados = 0;
  let total = 0;
  for (const m of movs) {
    const aplicado =
      m.payments.reduce((s, p) => s + p.amountApplied, 0) + (m.netZeroAmount ?? 0);
    const sobrante = Math.abs(m.amount) - aplicado;
    if (sobrante <= 100) continue;

    const desde = new Date(m.date);
    desde.setDate(desde.getDate() - 5);
    const hasta = new Date(m.date);
    hasta.setDate(hasta.getDate() + 60);
    const devoluciones = await prisma.bankMovement.findMany({
      where: {
        amount: { gt: sobrante - 50, lt: sobrante + 50 },
        date: { gte: desde, lte: hasta },
        payments: { none: {} },
        internalTransferToId: null,
        netZeroGroupId: null,
        status: { notIn: ["interno", "neto_cero"] },
      },
      select: { id: true, date: true, amount: true, description: true },
    });

    // Si hay más de una devolución posible, no se adivina: queda para MJ.
    if (devoluciones.length !== 1) {
      if (devoluciones.length > 1) {
        console.log(
          `  SALTEADO ${d(m.date)} ${(m.counterpartyName ?? "").slice(0, 24)}: ` +
            `${devoluciones.length} devoluciones posibles de ${clp(sobrante)} — decidilo a mano.`
        );
      }
      continue;
    }
    const dev = devoluciones[0];

    console.log(
      `  ${d(m.date)} ${(m.counterpartyName ?? m.description).slice(0, 26).padEnd(26)} ` +
        `pago ${clp(m.amount).padStart(13)} · sobrante ${clp(sobrante).padStart(10)} ` +
        `↔ devolución ${d(dev.date)} ${clp(dev.amount)}`
    );
    cerrados++;
    total += sobrante;

    if (APPLY) {
      const groupId = crypto.randomUUID();
      // El pago: se netea SOLO el sobrante, sus facturas no se tocan. Con el
      // sobrante explicado, el status deja de ser "parcial".
      await prisma.bankMovement.update({
        where: { id: m.id },
        data: {
          netZeroGroupId: groupId,
          netZeroAmount: (m.netZeroAmount ?? 0) + sobrante,
          status: "conciliado",
        },
      });
      // La devolución: se netea entera, es una devolución pura.
      await prisma.bankMovement.update({
        where: { id: dev.id },
        data: {
          netZeroGroupId: groupId,
          netZeroAmount: Math.abs(dev.amount),
          status: "neto_cero",
          category: null,
        },
      });
    }
  }
  console.log(`\n  >> ${cerrados} sobrepagos · ${clp(total)}`);
}

// ── PARTE 2 — la nota de crédito de Comercial Hispano ─────────────────────
//
// Dos notas de crédito por mercadería devuelta (una de JNC-Vitacura, otra de
// Portofino). Cada una paga la factura del RETIRO de esa mercadería y el resto
// vuelve al banco. Los dos restos llegaron juntos en UN depósito de $133.565:
//
//   NC JNC F-150709      $143.471   retiro JNC F-877855      −$26.637
//   NC Portofino F-149154 $39.222   retiro Portofino F-868724 −$22.491
//   ───────────────────────────────────────────────────────────────────
//   depósito                                                  $133.565
//
// Las dos facturas de retiro figuran ANULADAS y no lo están: son cobros reales
// del flete y la manipulación, que se pagaron con el crédito de la NC. Alguien
// las anuló para sacarlas del medio.
const CASOS_HISPANO = [
  { nc: "150709", retiro: "877855", obra: "JNC-Vitacura" },
  { nc: "149154", retiro: "868724", obra: "Portofino" },
];
const DEPOSITO_MONTO = 133565;

async function repartirNCHispano() {
  linea("2. NOTAS DE CRÉDITO DE COMERCIAL HISPANO");

  const depositos = await prisma.bankMovement.findMany({
    where: { amount: { gt: DEPOSITO_MONTO - 5, lt: DEPOSITO_MONTO + 5 } },
    select: { id: true, date: true, amount: true, description: true, status: true },
  });
  if (depositos.length !== 1) {
    console.log(
      `  NO SE PUEDE: se esperaba UN depósito de ${clp(DEPOSITO_MONTO)} y hay ${depositos.length}. Parar.`
    );
    return;
  }
  const deposito = depositos[0];
  console.log(
    `  depósito ${d(deposito.date)} ${clp(deposito.amount)} [${deposito.status}]`
  );

  let alBancoTotal = 0;
  for (const caso of CASOS_HISPANO) {
    const nc = await prisma.invoice.findFirst({
      where: { folioNumber: caso.nc, tipoDoc: 61 },
      select: { id: true, totalAmount: true, folioNumber: true },
    });
    const retiro = await prisma.invoice.findFirst({
      where: { folioNumber: caso.retiro },
      select: { id: true, totalAmount: true, status: true, folioNumber: true },
    });
    if (!nc || !retiro) {
      console.log(`  NO SE PUEDE: falta F-${caso.nc} o F-${caso.retiro}. Parar.`);
      return;
    }

    const total = Math.abs(nc.totalAmount);
    const aFactura = retiro.totalAmount;
    const alBanco = total - aFactura;
    alBancoTotal += alBanco;

    console.log(
      `\n  ${caso.obra}: NC F-${nc.folioNumber} ${clp(total)}` +
        `\n     → paga el retiro F-${retiro.folioNumber} ${clp(aFactura)} (hoy [${retiro.status}] → pagada)` +
        `\n     → vuelve al banco ${clp(alBanco)}`
    );

    if (APPLY) {
      await prisma.invoice.update({
        where: { id: nc.id },
        data: {
          compensationType: "split",
          appliedToInvoiceId: retiro.id,
          appliedAmount: aFactura,
          refundBankMovementId: deposito.id,
          refundAmount: alBanco,
          status: "pagada",
          paidAt: deposito.date,
        },
      });
      // La factura del retiro es un cobro REAL que se saldó con el crédito de
      // la NC: queda pagada, no anulada.
      await prisma.invoice.update({
        where: { id: retiro.id },
        data: { status: "pagada", paidAt: deposito.date },
      });
    }
  }

  const dif = alBancoTotal - deposito.amount;
  console.log(
    `\n  suma de lo que vuelve al banco: ${clp(alBancoTotal)} vs depósito ${clp(deposito.amount)} → diferencia ${clp(dif)}`
  );
  if (Math.abs(dif) > 10) {
    console.log("  ATENCIÓN: no cuadra. Revisar antes de aplicar.");
    return;
  }

  if (APPLY) {
    // El depósito queda saldado por las dos NC juntas.
    await prisma.bankMovement.update({
      where: { id: deposito.id },
      data: { status: "conciliado", category: "reembolso_proveedor" },
    });
  }
}

async function main() {
  console.log(`host: ${url.match(/@([^/]+)/)?.[1] ?? "?"}`);
  console.log(APPLY ? ">>> MODO ESCRITURA <<<" : ">>> DRY-RUN (no escribe nada) <<<");

  const antes = await fotoDeControl("ANTES");
  await cerrarSobrepagos();
  await repartirNCHispano();
  const despues = await fotoDeControl("DESPUÉS");

  linea("CONTROL — el gastado NO se puede mover");
  let ok = true;
  for (const o of OBRAS_A_VIGILAR) {
    const dif = despues.foto[o] - antes.foto[o];
    if (Math.abs(dif) > 1) ok = false;
    console.log(
      `  ${o.padEnd(16)} ${clp(antes.foto[o])} → ${clp(despues.foto[o])}  ${
        Math.abs(dif) <= 1 ? "sin cambios" : `SE MOVIÓ ${clp(dif)}`
      }`
    );
  }
  console.log(
    `\n  sin asignar: ${antes.pendientes} → ${despues.pendientes} (${despues.pendientes - antes.pendientes})`
  );
  console.log(
    `  parciales:   ${antes.parciales} → ${despues.parciales} (${despues.parciales - antes.parciales})`
  );
  if (!ok) console.log("\n  >> ALGO SE MOVIÓ. Revisar antes de dar esto por bueno.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
