import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  recomputeInvoiceStatus,
  getMovementAppliedAmount,
} from "@/lib/banco/invoicePayments";

/**
 * Borra una imputación específica de una factura (mov bancario → factura).
 * Usado desde el detalle de factura cuando MJ se equivocó al conciliar y
 * quiere quitar un pago para reasignarlo en /banco/movimientos.
 *
 * Después de borrar:
 *  - Recalcula `status` de la factura (pendiente / parcial / pagada).
 *  - Recalcula `status` del movimiento bancario (sin_asignar / parcial /
 *    conciliado) según cuánto le queda imputado.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id: invoiceId, paymentId } = await params;

    const payment = await prisma.invoicePayment.findUnique({
      where: { id: paymentId },
      include: {
        bankMovement: { select: { id: true, amount: true } },
      },
    });
    if (!payment) {
      return NextResponse.json(
        { error: "Imputación no encontrada" },
        { status: 404 }
      );
    }
    if (payment.invoiceId !== invoiceId) {
      return NextResponse.json(
        { error: "La imputación no corresponde a esta factura" },
        { status: 400 }
      );
    }

    const bankMovementId = payment.bankMovement.id;
    const absAmount = Math.abs(payment.bankMovement.amount);

    await prisma.invoicePayment.delete({ where: { id: paymentId } });

    // Recalcular status de la factura (puede volver a pendiente si era el
    // único pago, o quedar parcial si quedan otras imputaciones).
    await recomputeInvoiceStatus(invoiceId);

    // Recalcular status del mov. Misma lógica que el endpoint del mov.
    const sumApplied = await getMovementAppliedAmount(bankMovementId);
    let newStatus: string;
    if (sumApplied <= 0) newStatus = "sin_asignar";
    else if (sumApplied >= absAmount - 1) newStatus = "conciliado";
    else newStatus = "parcial";
    await prisma.bankMovement.update({
      where: { id: bankMovementId },
      data: { status: newStatus },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al eliminar";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
