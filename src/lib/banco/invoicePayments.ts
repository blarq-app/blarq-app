// Helpers para manejar imputaciones movimiento↔factura (InvoicePayment).
//
// Una factura puede recibir cobros parciales (varios movimientos) y un
// movimiento puede aplicarse a varias facturas. La fuente de verdad del
// "cuánto está cobrado" de una factura es Σ(InvoicePayment.amountApplied)
// para esa factura — el campo Invoice.status es derivado.

import { prisma } from "@/lib/prisma";

/**
 * Recalcula el `status` y `paidAt` de una factura a partir de sus
 * InvoicePayment. Llamar después de crear/borrar/modificar pagos.
 *
 *   pendiente : 0 imputado
 *   parcial   : 0 < imputado < totalAmount
 *   pagada    : imputado >= totalAmount   (paidAt = max(date) de los movs)
 *
 * Tolera $1 de redondeo (CLP no tiene decimales pero la API devuelve floats).
 */
export async function recomputeInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, status: true },
  });
  if (!invoice) return;

  // status="anulada" no se toca — anulación es manual, no derivada.
  if (invoice.status === "anulada") return;

  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId },
    select: {
      amountApplied: true,
      bankMovement: { select: { date: true } },
    },
  });

  const sumApplied = payments.reduce((s, p) => s + p.amountApplied, 0);

  let nextStatus: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;

  if (sumApplied >= invoice.totalAmount - 1) {
    nextStatus = "pagada";
    // paidAt = fecha del último movimiento que cerró la factura.
    paidAt = payments.reduce<Date | null>((latest, p) => {
      const d = p.bankMovement.date;
      return !latest || d > latest ? d : latest;
    }, null);
  } else if (sumApplied > 0) {
    nextStatus = "parcial";
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: nextStatus, paidAt },
  });
}

/**
 * Devuelve cuánto del monto de un movimiento bancario ya está imputado
 * a facturas (suma de InvoicePayment.amountApplied para ese mov).
 * Útil para validar antes de asignar más imputaciones.
 */
export async function getMovementAppliedAmount(bankMovementId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { bankMovementId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}

/**
 * Idem para una factura: cuánto está cobrado a la fecha.
 */
export async function getInvoicePaidAmount(invoiceId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { invoiceId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}
