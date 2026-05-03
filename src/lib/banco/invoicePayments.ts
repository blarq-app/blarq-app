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

/**
 * Auto-conciliación al emitir una factura nueva: busca movimientos
 * bancarios sin asignar del mismo RUT contraparte que matcheen el
 * monto exacto (caso típico MJ: te pagan, después emitís factura).
 *
 * Heurística conservadora — solo aplica si hay un único mov candidato:
 *   - mismo type opuesto (factura emitida → busca abono; recibida → cargo)
 *   - mismo RUT contraparte
 *   - status sin_asignar (no parcial todavía, evita pisar imputaciones)
 *   - |amount| coincide ±$10 con totalAmount
 *
 * Si encuentra exactamente un match, crea el InvoicePayment y actualiza
 * status del mov a "conciliado" + status de la factura a "pagada".
 *
 * Si hay 0 o múltiples candidatos, no toca nada — MJ resuelve manual.
 *
 * Devuelve cuántos movs auto-vinculó (0 o 1).
 */
export async function tryAutoMatchInvoiceWithExistingMovs(invoiceId: string): Promise<number> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      totalAmount: true,
      status: true,
      rutIssuer: true,
      rutReceiver: true,
      payments: { select: { id: true } },
    },
  });
  if (!inv) return 0;
  // Si la factura ya tiene pagos o no está pendiente, no tocar.
  if (inv.payments.length > 0 || inv.status !== "pendiente") return 0;
  // NCs no se "pagan" auto.
  if (inv.tipoDoc === 61) return 0;

  // Para emitidas, contraparte = cliente = rutReceiver (el cliente de BLARQ).
  // Para recibidas, contraparte = proveedor = rutIssuer.
  const counterpartyRut = inv.type === "emitida" ? inv.rutReceiver : inv.rutIssuer;
  if (!counterpartyRut) return 0;
  const counterpartyDigits = counterpartyRut.replace(/\D/g, "");
  if (counterpartyDigits.length < 7) return 0;

  // Cargos para recibida (mov.amount<0), abonos para emitida (mov.amount>0).
  // Filtramos por RUT con un substring match — el banco prefija con 0 a veces.
  const candidates = await prisma.bankMovement.findMany({
    where: {
      status: "sin_asignar",
      counterpartyRut: { contains: counterpartyDigits.slice(-8) },
      ...(inv.type === "emitida"
        ? { amount: { gte: inv.totalAmount - 10, lte: inv.totalAmount + 10 } }
        : { amount: { gte: -(inv.totalAmount + 10), lte: -(inv.totalAmount - 10) } }),
    },
    select: { id: true, amount: true, date: true },
    take: 5,
  });

  if (candidates.length !== 1) return 0;

  const mov = candidates[0];
  await prisma.invoicePayment.create({
    data: {
      bankMovementId: mov.id,
      invoiceId: inv.id,
      amountApplied: Math.abs(mov.amount),
    },
  });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: "conciliado" },
  });
  await recomputeInvoiceStatus(inv.id);
  return 1;
}
