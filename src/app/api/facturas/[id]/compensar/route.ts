import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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
      select: { id: true, tipoDoc: true },
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
      if (mov.status === "sin_asignar") {
        await prisma.bankMovement.update({
          where: { id: movId },
          data: { status: "conciliado", category: "reembolso_proveedor" },
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

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error compensando NC:", error);
    return NextResponse.json(
      { error: "Error al compensar NC" },
      { status: 500 }
    );
  }
}
