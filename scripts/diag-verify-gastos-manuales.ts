import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
} from "../src/lib/projects/metrics";
import { computeEstadoResultadoFacturacion } from "../src/lib/dashboard/estadoResultado";

// Verificación del flujo "Registrar gasto" (boleta / internacional) SIN pasar
// por la UI: replica lo que hace la acción registrar_gasto del route handler,
// comprueba que:
//   (1) el gasto SUBE el "gastado" de la obra por el total (metrics.ts),
//   (2) NO cambia la vista Facturación del Estado de Resultado (queda fuera,
//       porque es tipoDoc 1043),
// y al final BORRA todo lo que creó (base dev intacta).
//
// Corre contra la base del .env (dev = ep-solitary-mud). Aborta si detecta prod.

const BLARQ_RUT = "77270733-9";
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("ASSERT FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}

async function metricsGastado(projectId: string): Promise<number> {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: PROJECT_METRICS_INCLUDE,
  });
  return computeProjectMetrics(p).totalGastado;
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log("BASE DE DATOS host:", host);
  if (host.includes("ep-shy-morning")) {
    throw new Error("Esto apunta a PROD (ep-shy-morning). Abortando el test de escritura.");
  }

  // Proyecto real (con presupuesto) para la boleta.
  const project = await prisma.project.findFirst({
    where: { isInternal: false, budgetVersions: { some: {} } },
    orderBy: { numeroProyecto: "desc" },
    select: { id: true, name: true, numeroProyecto: true },
  });
  if (!project) throw new Error("No hay proyecto con presupuesto en dev.");

  // Proyecto interno de BLARQ para el gasto internacional (gastos de empresa).
  const internal = await prisma.project.findFirst({
    where: { isInternal: true },
    select: { id: true, name: true },
  });

  const category = await prisma.costCategory.findFirst({
    select: { id: true, name: true },
  });
  if (!category) throw new Error("No hay categorías en dev.");

  // Dos egresos sin imputación para conciliar.
  const movs = await prisma.bankMovement.findMany({
    where: { amount: { lt: 0 }, status: { not: "interno" }, payments: { none: {} } },
    take: 2,
    orderBy: { date: "desc" },
    select: { id: true, amount: true, date: true, externalRef: true, counterpartyRut: true, counterpartyName: true },
  });
  if (movs.length < 2) throw new Error("Faltan egresos libres en dev para el test.");

  console.log("\nProyecto obra:", project.numeroProyecto, project.name);
  console.log("Proyecto empresa (interno):", internal?.name ?? "(ninguno)");
  console.log("Categoría:", category.name);

  const createdInvoiceIds: string[] = [];
  const touchedMovIds: string[] = [];

  try {
    // ── CASO 1: BOLETA en la obra, conciliada ────────────────────────────
    const mBol = movs[0];
    const montoBol = Math.abs(mBol.amount);
    const year = mBol.date.getFullYear();

    console.log("\n── CASO 1: Boleta en la obra (conciliada) ──");
    console.log("  Movimiento:", clp(mBol.amount), "·", mBol.date.toISOString().slice(0, 10));
    const gastadoBefore = await metricsGastado(project.id);
    const erBefore = await computeEstadoResultadoFacturacion(year);

    const invBol = await prisma.invoice.create({
      data: {
        projectId: project.id,
        categoryId: category.id,
        type: "recibida",
        tipoDoc: 1043,
        folioNumber: `BOL-${mBol.externalRef || mBol.id}`,
        rutIssuer: mBol.counterpartyRut,
        rutReceiver: BLARQ_RUT,
        businessName: mBol.counterpartyName,
        issueDate: mBol.date,
        dueDate: mBol.date,
        netAmount: montoBol,
        iva: 0,
        totalAmount: montoBol,
        status: "pagada",
        paidAt: mBol.date,
        origin: "gasto_boleta",
        notes: "Boleta. Registrado desde el movimiento bancario. [TEST]",
      },
    });
    createdInvoiceIds.push(invBol.id);
    await prisma.invoicePayment.create({
      data: { bankMovementId: mBol.id, invoiceId: invBol.id, amountApplied: montoBol },
    });
    await prisma.bankMovement.update({ where: { id: mBol.id }, data: { status: "conciliado", category: null } });
    touchedMovIds.push(mBol.id);

    const gastadoAfter = await metricsGastado(project.id);
    const erAfter = await computeEstadoResultadoFacturacion(year);

    console.log(`  Gastado obra: ${clp(gastadoBefore)} → ${clp(gastadoAfter)} (Δ ${clp(gastadoAfter - gastadoBefore)})`);
    assert(Math.round(gastadoAfter - gastadoBefore) === Math.round(montoBol), `el gastado de la obra sube EXACTO por el total de la boleta (${clp(montoBol)})`);
    console.log(`  Facturación egreso ${year}: ${clp(erBefore.totales.egreso)} → ${clp(erAfter.totales.egreso)}`);
    assert(Math.round(erBefore.totales.egreso) === Math.round(erAfter.totales.egreso), "la vista Facturación NO cambia (la boleta queda fuera)");
    assert(Math.round(erBefore.totales.ivaCredito) === Math.round(erAfter.totales.ivaCredito), "el IVA crédito del F29 NO se toca (boleta sin IVA)");

    // ── CASO 2: INTERNACIONAL en empresa, conciliado ────────────────────
    if (internal) {
      const mInt = movs[1];
      const montoInt = Math.abs(mInt.amount);
      console.log("\n── CASO 2: Internacional en BLARQ/empresa (conciliado) ──");
      const gEmpBefore = await metricsGastado(internal.id);
      const invInt = await prisma.invoice.create({
        data: {
          projectId: internal.id,
          categoryId: category.id,
          type: "recibida",
          tipoDoc: 1043,
          folioNumber: `INT-${mInt.externalRef || mInt.id}`,
          rutIssuer: mInt.counterpartyRut,
          rutReceiver: BLARQ_RUT,
          businessName: mInt.counterpartyName,
          issueDate: mInt.date,
          dueDate: mInt.date,
          netAmount: montoInt,
          iva: 0,
          totalAmount: montoInt,
          status: "pagada",
          paidAt: mInt.date,
          origin: "gasto_internacional",
          notes: "Gasto internacional. Registrado desde el movimiento bancario. [TEST]",
        },
      });
      createdInvoiceIds.push(invInt.id);
      await prisma.invoicePayment.create({
        data: { bankMovementId: mInt.id, invoiceId: invInt.id, amountApplied: montoInt },
      });
      await prisma.bankMovement.update({ where: { id: mInt.id }, data: { status: "conciliado", category: null } });
      touchedMovIds.push(mInt.id);
      const gEmpAfter = await metricsGastado(internal.id);
      console.log(`  Gastado empresa: ${clp(gEmpBefore)} → ${clp(gEmpAfter)} (Δ ${clp(gEmpAfter - gEmpBefore)})`);
      assert(Math.round(gEmpAfter - gEmpBefore) === Math.round(montoInt), `el gasto internacional entra al gastado de la empresa (${clp(montoInt)})`);

      // El movimiento quedó conciliado contra el gasto (deja de estar pendiente).
      const movAfter = await prisma.bankMovement.findUniqueOrThrow({ where: { id: mInt.id }, select: { status: true, payments: { select: { id: true } } } });
      assert(movAfter.status === "conciliado" && movAfter.payments.length === 1, "el movimiento queda conciliado contra el gasto");
    }

    console.log("\nTODO OK ✅");
  } finally {
    // ── LIMPIEZA ─────────────────────────────────────────────────────────
    console.log("\n── Limpieza ──");
    await prisma.invoicePayment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    for (const id of touchedMovIds) {
      await prisma.bankMovement.update({ where: { id }, data: { status: "sin_asignar" } });
    }
    console.log(`  Borradas ${createdInvoiceIds.length} facturas de test; ${touchedMovIds.length} movimiento(s) devuelto(s) a sin_asignar.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
