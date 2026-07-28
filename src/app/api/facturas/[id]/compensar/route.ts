import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";
import { MOV_STATUS } from "@/lib/banco/movementStatus";
import { requireSession } from "@/lib/apiAuth";

// Compensar una NC (tipoDoc=61) de tres maneras:
//   - other_invoice: la NC se aplica a OTRA factura como medio de pago.
//     Caso DP. Body: { type, appliedToInvoiceId }.
//   - cash_refund: el proveedor te devolvió la plata en efectivo.
//     Caso Sodimac. Body: { type }.
//   - bank_refund: el proveedor te devolvió la plata a tu cuenta bancaria.
//     Body: { type, refundBankMovementId }.
//
// En los tres casos la NC queda fuera del "saldo pendiente" visual. La
// reducción del gasto la hace metrics.ts con sign(-1) sobre tipoDoc=61
// (no cambia con esta operación).
//
// Para limpiar la compensación: { type: null }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();
    const type: string | null =
      data.type === "other_invoice" ||
      data.type === "cash_refund" ||
      data.type === "bank_refund"
        ? data.type
        : null;

    const nc = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, tipoDoc: true, totalAmount: true, appliedToInvoiceId: true },
    });
    if (!nc) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
    if (nc.tipoDoc !== 61) {
      return NextResponse.json(
        { error: "Solo las NC (tipoDoc=61) se pueden compensar" },
        { status: 400 }
      );
    }

    // Si antes la NC estaba aplicada a otra factura y ahora cambiamos
    // (a null, a otro tipo o a otra factura), hay que recalcular el
    // estado de la factura ANTERIOR — vuelve a pendiente / parcial si
    // tiene pagos reales, sino pendiente.
    const previousTargetId = nc.appliedToInvoiceId;

    const updates: {
      compensationType: string | null;
      appliedToInvoiceId: string | null;
      refundBankMovementId: string | null;
      status: string;
      paidAt: Date | null;
    } = {
      compensationType: type,
      appliedToInvoiceId: null,
      refundBankMovementId: null,
      // Al compensar (any modo), la NC sale del pendiente. Al limpiar
      // (type=null), vuelve a "pendiente" para que aparezca en stats.
      status: type ? "pagada" : "pendiente",
      paidAt: type ? new Date() : null,
    };

    if (type === "other_invoice") {
      const targetId = String(data.appliedToInvoiceId ?? "");
      if (!targetId) {
        return NextResponse.json(
          { error: "Falta appliedToInvoiceId para type=other_invoice" },
          { status: 400 }
        );
      }
      const target = await prisma.invoice.findUnique({
        where: { id: targetId },
        select: { id: true, tipoDoc: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Factura objetivo no encontrada" },
          { status: 404 }
        );
      }
      if (target.tipoDoc === 61) {
        return NextResponse.json(
          { error: "No se puede compensar una NC con otra NC" },
          { status: 400 }
        );
      }
      updates.appliedToInvoiceId = targetId;
    }

    if (type === "bank_refund") {
      const movId = String(data.refundBankMovementId ?? "");
      if (!movId) {
        return NextResponse.json(
          { error: "Falta refundBankMovementId para type=bank_refund" },
          { status: 400 }
        );
      }
      const mov = await prisma.bankMovement.findUnique({
        where: { id: movId },
        select: { id: true, amount: true, status: true },
      });
      if (!mov) {
        return NextResponse.json(
          { error: "Movimiento bancario no encontrado" },
          { status: 404 }
        );
      }
      if (mov.amount <= 0) {
        return NextResponse.json(
          { error: "El movimiento debe ser un ingreso (abono) — el reembolso entró a la cuenta" },
          { status: 400 }
        );
      }
      updates.refundBankMovementId = movId;
      // Marcar el mov bancario como conciliado (igual que cuando se asigna
      // a una factura emitida), así no queda como "sin asignar" pendiente.
      // Caso especial documentado en movementStatus.ts: es un conciliado SIN
      // InvoicePayment (lo salda la NC, linkeada por refundBankMovementId).
      // Si la NC se borra, el DELETE de facturas lo recomputa y vuelve a la cola.
      if (mov.status === "sin_asignar") {
        await prisma.bankMovement.update({
          where: { id: movId },
          data: { status: MOV_STATUS.CONCILIADO, category: "reembolso_proveedor" },
        });
      }
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        compensationType: true,
        appliedToInvoiceId: true,
        refundBankMovementId: true,
      },
    });

    // Recalcular status de la factura objetivo (la que la NC anula).
    // - Si type=other_invoice, la factura queda "anulada" cuando la NC
    //   la cubre completa (mismo monto), o se recalcula por pagos si la
    //   NC es parcial.
    // - Si limpiamos / cambiamos a otro tipo, revertimos la factura
    //   anterior al estado que le corresponde por sus pagos reales.
    const newTargetId = updates.appliedToInvoiceId;
    if (previousTargetId && previousTargetId !== newTargetId) {
      await recomputeInvoiceStatus(previousTargetId);
    }
    if (newTargetId) {
      const target = await prisma.invoice.findUnique({
        where: { id: newTargetId },
        select: { totalAmount: true, payments: { select: { amountApplied: true } } },
      });
      if (target) {
        const realPaid = target.payments.reduce((s, p) => s + p.amountApplied, 0);
        const ncAbs = Math.abs(nc.totalAmount);
        if (realPaid >= target.totalAmount - 10) {
          // CASO 1 — la factura ya estaba pagada entera por el banco antes
          // de la NC. La NC es una DEVOLUCIÓN, no anula la factura: queda
          // "pagada". La seteamos explícita (recompute saltaría si quedó
          // "anulada" por el bug viejo, y no la corregiría).
          await prisma.invoice.update({
            where: { id: newTargetId },
            data: { status: "pagada" },
          });
        } else if (realPaid + ncAbs >= target.totalAmount - 10) {
          // CASOS 2/3 — la NC + lo pagado cubren el total:
          //  - Caso 2: pagaste una parte real → SALDADA = "pagada".
          //  - Caso 3: no pagaste nada → la compra se deshizo entera = "anulada".
          await prisma.invoice.update({
            where: { id: newTargetId },
            data: { status: realPaid > 0 ? "pagada" : "anulada", paidAt: new Date() },
          });
        } else {
          // CASO 4 — NC chica, todavía debés saldo → parcial.
          await recomputeInvoiceStatus(newTargetId);
          if (realPaid <= 0 && ncAbs > 0) {
            await prisma.invoice.update({
              where: { id: newTargetId },
              data: { status: "parcial" },
            });
          }
        }
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error compensando NC:", error);
    return NextResponse.json(
      { error: "Error al compensar NC" },
      { status: 500 }
    );
  }
}
