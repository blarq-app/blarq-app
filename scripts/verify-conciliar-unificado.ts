/**
 * Verificación del gesto unificado de conciliación (rama conciliar-unificado).
 *
 * Contesta tres preguntas, todas SOLO LECTURA sobre la base de DEV:
 *
 *   1. ¿La propuesta "segura" coincide EXACTAMENTE con lo que el motor viejo
 *      ataba solo? Si divergieran, habríamos vuelto a tener dos opiniones
 *      distintas sobre el mismo movimiento — justo el bug que este cambio
 *      viene a cerrar. Para compararlo de verdad (y no tautológicamente contra
 *      la función nueva), este script REIMPLEMENTA el filtro de candidatas tal
 *      como estaba antes del refactor y decide con el mismo núcleo puro.
 *
 *   2. ¿Cuántas "probables" aparecen? Son las que antes quedaban pendientes en
 *      silencio y ahora se muestran rotuladas. No se aplican solas.
 *
 *   3. Foto de la plata: cuántos pagos hay y cuánto suman. Se imprime para
 *      poder correr el script antes y después de tocar la pantalla y confirmar
 *      que PROPONER no escribe nada.
 *
 * Uso:  npx tsx scripts/verify-conciliar-unificado.ts
 *
 * OJO (§4.9): fuerza la conexión de DEV a mano. Los scripts que solo hacen
 * `import "dotenv/config"` terminan leyendo la base que ya esté en el shell,
 * y así se han sacado conclusiones sobre la base equivocada.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  decideMovementInvoiceMatch,
  proposeMovementInvoiceMatch,
  loadReembolsadores,
  loadCandidateInvoices,
} from "../src/lib/banco/invoicePayments";

config({ path: ".env", override: true });

const prisma = new PrismaClient();

// Copia del filtro de candidatas TAL COMO estaba antes del refactor, para
// comparar contra la función nueva en vez de asumir que son iguales.
function candidatasComoAntes(
  mov: { amount: number },
  invoices: Awaited<ReturnType<typeof loadCandidateInvoices>>,
  excluidas: Set<string>
) {
  const isCargo = mov.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";
  const absAmount = Math.abs(mov.amount);
  return invoices
    .filter(
      (c) =>
        c.type === targetType &&
        !excluidas.has(c.id) &&
        c.totalAmount >= absAmount - 10
    )
    .map((c) => {
      const paid = c.payments.reduce((s, p) => s + p.amountApplied, 0);
      return { ...c, remaining: c.totalAmount - paid };
    })
    .filter(
      (c) => c.remaining >= absAmount - 10 && c.remaining <= absAmount + 10
    );
}

// Réplica del alias de reembolsador (misma lógica que aliasRutsFromList).
function aliasRuts(
  description: string,
  counterpartyRut: string | null,
  reembolsadores: Awaited<ReturnType<typeof loadReembolsadores>>
): string[] {
  const desc = (description ?? "").toLowerCase();
  const movRut = (counterpartyRut ?? "").replace(/\D/g, "");
  if (!desc && !movRut) return [];
  const ruts = new Set<string>();
  for (const r of reembolsadores) {
    const pr = (r.personRut ?? "").replace(/\D/g, "");
    const porRut = pr.length > 0 && movRut && (pr.includes(movRut) || movRut.includes(pr));
    const porGlosa = desc.includes(r.glosa.toLowerCase());
    if (porRut || porGlosa) {
      for (const a of r.aliases) {
        const d = a.rut.replace(/\D/g, "");
        if (d.length > 0) ruts.add(d.slice(-8));
      }
    }
  }
  return [...ruts];
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/ep-[a-z]+-[a-z]+/)?.[0];
  console.log(`Base: ${host ?? "?"}${host === "ep-shy-morning" ? "  ← ¡ES LA VIVA!" : "  (dev)"}\n`);
  if (host === "ep-shy-morning") {
    console.log("Este script es de verificación en dev. Abortando.");
    return;
  }

  // ── 3. Foto de la plata (antes de tocar nada) ──────────────────────────
  const pagosAntes = await prisma.invoicePayment.aggregate({
    _count: true,
    _sum: { amountApplied: true },
  });
  const porEstado = await prisma.bankMovement.groupBy({
    by: ["status"],
    _count: true,
  });
  console.log("── Foto de la plata ──");
  console.log(`Pagos (InvoicePayment): ${pagosAntes._count}`);
  console.log(
    `Suma imputada: $${Math.round(pagosAntes._sum.amountApplied ?? 0).toLocaleString("es-CL")}`
  );
  console.log(
    "Movimientos por estado: " +
      porEstado.map((e) => `${e.status}=${e._count}`).join(" · ")
  );

  // ── 1 y 2. Propuesta nueva vs motor viejo ──────────────────────────────
  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      description: true,
      counterpartyRut: true,
      counterpartyName: true,
      date: true,
      category: true,
      payments: { select: { id: true } },
    },
    orderBy: { date: "desc" },
  });

  const reembolsadores = await loadReembolsadores();
  const invoices = await loadCandidateInvoices();

  // Camino NUEVO (el que va a usar la pantalla).
  const reservadasNuevo = new Set<string>();
  const nuevoSeguras = new Map<string, string>();
  let probables = 0;
  let sinNada = 0;
  const ejemplosProbables: string[] = [];

  for (const mov of movs) {
    const p = await proposeMovementInvoiceMatch(mov, reembolsadores, {
      invoices,
      excludeInvoiceIds: reservadasNuevo,
    });
    if (!p.invoiceId) {
      sinNada++;
      continue;
    }
    reservadasNuevo.add(p.invoiceId);
    if (p.confianza === "segura") nuevoSeguras.set(mov.id, p.invoiceId);
    else {
      probables++;
      if (ejemplosProbables.length < 5) {
        ejemplosProbables.push(
          `  · ${new Date(mov.date).toISOString().slice(0, 10)} ${mov.description.slice(0, 40)}\n    ${p.motivo}`
        );
      }
    }
  }

  // Camino VIEJO reimplementado (candidatas de antes + núcleo puro).
  // OJO: el viejo reservaba la factura solo cuando ATABA; replicamos eso.
  const reservadasViejo = new Set<string>();
  const viejoMatches = new Map<string, string>();
  for (const mov of movs) {
    const candidates = candidatasComoAntes(mov, invoices, reservadasViejo);
    if (candidates.length === 0) continue;
    const decision = decideMovementInvoiceMatch({
      candidates,
      isCargo: mov.amount < 0,
      movRutDigits: (mov.counterpartyRut ?? "").replace(/\D/g, ""),
      aliasRutDigits: aliasRuts(mov.description, mov.counterpartyRut, reembolsadores),
      movDescription: mov.description,
      movDate: mov.date,
    });
    if (!("reason" in decision)) {
      reservadasViejo.add(decision.invoiceId);
      viejoMatches.set(mov.id, decision.invoiceId);
    }
  }

  console.log(`\n── Propuesta nueva sobre ${movs.length} pendientes ──`);
  console.log(`Seguras (se tildan solas): ${nuevoSeguras.size}`);
  console.log(`Probables (destildadas, con motivo): ${probables}`);
  console.log(`Sin ninguna candidata: ${sinNada}`);

  console.log(`\n── ¿Coincide "segura" con lo que el motor viejo ataba? ──`);
  console.log(`Motor viejo ataba: ${viejoMatches.size}`);

  const soloNuevo = [...nuevoSeguras].filter(([m, i]) => viejoMatches.get(m) !== i);
  const soloViejo = [...viejoMatches].filter(([m, i]) => nuevoSeguras.get(m) !== i);

  if (soloNuevo.length === 0 && soloViejo.length === 0) {
    console.log("IDÉNTICO — mismo conjunto de pares (movimiento, factura).");
  } else {
    console.log(`DIFIEREN. Solo en el nuevo: ${soloNuevo.length} · solo en el viejo: ${soloViejo.length}`);
    for (const [m, i] of [...soloNuevo.slice(0, 5), ...soloViejo.slice(0, 5)]) {
      console.log(`  mov ${m} → factura ${i}`);
    }
  }

  if (ejemplosProbables.length > 0) {
    console.log(`\n── Ejemplos de "probables" (antes invisibles) ──`);
    console.log(ejemplosProbables.join("\n"));
  }

  // ── La plata no se movió: proponer es solo lectura ─────────────────────
  const pagosDespues = await prisma.invoicePayment.aggregate({
    _count: true,
    _sum: { amountApplied: true },
  });
  const igual =
    pagosDespues._count === pagosAntes._count &&
    (pagosDespues._sum.amountApplied ?? 0) === (pagosAntes._sum.amountApplied ?? 0);
  console.log(
    `\n── Después de proponer: ${pagosDespues._count} pagos · ${igual ? "SIN CAMBIOS" : "¡CAMBIÓ!"}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
