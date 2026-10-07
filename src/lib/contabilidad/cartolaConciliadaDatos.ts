import type { PrismaClient } from "@prisma/client";
import { aporteAlMovimiento } from "@/lib/banco/ncSplit";
import {
  armarCartola,
  saldoAlCierre,
  type CartolaConciliada,
  type DatosCartola,
  type DocumentoCartola,
  type MovimientoReferido,
} from "./cartolaConciliada";

// Lectura de la base para la cartola conciliada del mes (ver
// cartolaConciliada.ts). SOLO LEE: no escribe nada ni recalcula estados.
//
// Vive aparte del armado para que el armado sea puro y se pueda probar sin
// base. La usan la pantalla de Contabilidad → Cartola, el endpoint que baja el
// Excel / PDF y cualquier script de verificación: una sola consulta, así los
// tres dan lo mismo.

const SELECT_DOCUMENTO = {
  id: true,
  type: true,
  tipoDoc: true,
  folioNumber: true,
  rutIssuer: true,
  rutReceiver: true,
  businessName: true,
  totalAmount: true,
  origin: true,
  status: true,
  issueDate: true,
} as const;

const SELECT_REFERIDO = {
  id: true,
  bankAccountId: true,
  date: true,
  amount: true,
  description: true,
  netZeroGroupId: true,
  netZeroAmount: true,
} as const;

/**
 * Junta todo lo que hace falta para la cartola de un mes (`month` de 1 a 12) o
 * del año completo (`month` null). Los límites son en UTC: las fechas de los
 * movimientos se guardan como día calendario a medianoche UTC (mismo criterio
 * que Contabilidad → Gastos).
 */
export async function cargarDatosCartola(
  db: PrismaClient,
  year: number,
  month: number | null
): Promise<DatosCartola> {
  const inicio = new Date(Date.UTC(year, month == null ? 0 : month - 1, 1));
  const finExclusivo = new Date(Date.UTC(month == null ? year + 1 : year, month == null ? 0 : month, 1));

  const [cuentasRaw, movsRaw, empleados] = await Promise.all([
    db.bankAccount.findMany({ orderBy: { role: "asc" } }),
    db.bankMovement.findMany({
      where: { date: { gte: inicio, lt: finExclusivo } },
      select: {
        id: true,
        bankAccountId: true,
        date: true,
        description: true,
        amount: true,
        balanceAfter: true,
        status: true,
        category: true,
        counterpartyName: true,
        counterpartyRut: true,
        salaryPeriod: true,
        netZeroGroupId: true,
        netZeroAmount: true,
        internalTransferToId: true,
        internalTransferFrom: { select: { id: true } },
        internalConcepto: true,
        project: { select: { name: true } },
        payments: { select: { invoiceId: true, amountApplied: true } },
      },
    }),
    db.empleado.findMany({ select: { rut: true, nombre: true } }),
  ]);

  // Saldo de la cartola justo antes del período, por cuenta: el cierre del
  // último día con movimientos (ver saldoAlCierre).
  const cuentas = await Promise.all(
    cuentasRaw.map(async (c) => {
      const ultimaFecha = await db.bankMovement.findFirst({
        where: { bankAccountId: c.id, date: { lt: inicio } },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      const delDia = ultimaFecha
        ? await db.bankMovement.findMany({
            where: { bankAccountId: c.id, date: ultimaFecha.date },
            select: { date: true, amount: true, description: true, balanceAfter: true },
          })
        : [];
      return { id: c.id, alias: c.alias, accountNumber: c.accountNumber, saldoInicialBanco: saldoAlCierre(delDia) };
    })
  );

  const idsMes = movsRaw.map((m) => m.id);

  // Notas de crédito cuya plata volvió por un movimiento del período.
  const ncDevueltas = await db.invoice.findMany({
    where: { refundBankMovementId: { in: idsMes } },
    select: {
      ...SELECT_DOCUMENTO,
      compensationType: true,
      appliedToInvoiceId: true,
      appliedAmount: true,
      refundBankMovementId: true,
      refundAmount: true,
    },
  });

  // Documentos pagados por los movimientos del período, y TODOS sus pagos (de
  // cualquier fecha) para la hoja por factura.
  const idsDocumentos = Array.from(new Set(movsRaw.flatMap((m) => m.payments.map((p) => p.invoiceId))));
  const [documentosPagados, pagosDeDocumentos, ncAplicadasRaw] = await Promise.all([
    db.invoice.findMany({ where: { id: { in: idsDocumentos } }, select: SELECT_DOCUMENTO }),
    db.invoicePayment.findMany({
      where: { invoiceId: { in: idsDocumentos } },
      select: { invoiceId: true, bankMovementId: true, amountApplied: true },
    }),
    db.invoice.findMany({
      where: { tipoDoc: 61, appliedToInvoiceId: { in: idsDocumentos } },
      select: { appliedToInvoiceId: true, folioNumber: true, totalAmount: true, appliedAmount: true },
    }),
  ]);

  // Movimientos de fuera del período que hay que nombrar: par de traspaso, la otra
  // mitad de un neto cero, transferencias de otras fechas que pagaron facturas.
  const idsMesSet = new Set(idsMes);
  const gruposNetoCero = Array.from(new Set(movsRaw.map((m) => m.netZeroGroupId).filter((g): g is string => !!g)));
  const idsPares = movsRaw.flatMap((m) => [m.internalTransferToId, m.internalTransferFrom?.id]).filter((x): x is string => !!x);
  const idsPagosFuera = pagosDeDocumentos.map((p) => p.bankMovementId);
  const idsReferidos = Array.from(new Set([...idsPares, ...idsPagosFuera])).filter((id) => !idsMesSet.has(id));
  const referidosRaw = await db.bankMovement.findMany({
    where: {
      OR: [
        { id: { in: idsReferidos } },
        ...(gruposNetoCero.length ? [{ netZeroGroupId: { in: gruposNetoCero } }] : []),
      ],
    },
    select: SELECT_REFERIDO,
  });
  const referidos: MovimientoReferido[] = referidosRaw
    .filter((r) => !idsMesSet.has(r.id))
    .map((r) => ({
      id: r.id,
      cuentaId: r.bankAccountId,
      date: r.date,
      amount: r.amount,
      description: r.description,
      netZeroGroupId: r.netZeroGroupId,
      netZeroAmount: r.netZeroAmount,
    }));

  const documentos: DocumentoCartola[] = [...documentosPagados, ...ncDevueltas].map((d) => ({
    id: d.id,
    type: d.type,
    tipoDoc: d.tipoDoc,
    folioNumber: d.folioNumber,
    rutIssuer: d.rutIssuer,
    rutReceiver: d.rutReceiver,
    businessName: d.businessName,
    totalAmount: d.totalAmount,
    origin: d.origin,
    status: d.status,
    issueDate: d.issueDate,
  }));

  return {
    year,
    month,
    cuentas,
    movimientos: movsRaw.map((m) => ({
      id: m.id,
      cuentaId: m.bankAccountId,
      date: m.date,
      description: m.description,
      amount: m.amount,
      balanceAfter: m.balanceAfter,
      status: m.status,
      category: m.category,
      counterpartyName: m.counterpartyName,
      counterpartyRut: m.counterpartyRut,
      salaryPeriod: m.salaryPeriod,
      netZeroGroupId: m.netZeroGroupId,
      netZeroAmount: m.netZeroAmount,
      parInternoId: m.internalTransferToId ?? m.internalTransferFrom?.id ?? null,
      projectName: m.project?.name ?? null,
      internalConcepto: m.internalConcepto,
      pagos: m.payments,
      // El pedazo de cada NC que volvió por ESTE movimiento (una NC partida
      // trae solo una parte).
      ncDevueltas: ncDevueltas
        .filter((nc) => nc.refundBankMovementId === m.id)
        .map((nc) => ({ invoiceId: nc.id, monto: aporteAlMovimiento(nc) })),
    })),
    referidos,
    documentos,
    pagosDeDocumentos,
    ncAplicadas: ncAplicadasRaw.map((nc) => ({
      invoiceId: nc.appliedToInvoiceId!,
      folio: nc.folioNumber,
      monto: nc.appliedAmount ?? Math.abs(nc.totalAmount),
    })),
    empleados,
  };
}

export async function cargarCartola(
  db: PrismaClient,
  year: number,
  month: number | null
): Promise<CartolaConciliada> {
  return armarCartola(await cargarDatosCartola(db, year, month));
}
