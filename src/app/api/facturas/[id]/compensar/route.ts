import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";
import { recomputeMovementsStatus } from "@/lib/banco/movementStatus";
import { validarSplit } from "@/lib/banco/ncSplit";
import { requireSession } from "@/lib/apiAuth";

// Compensar una NC (tipoDoc=61) de cuatro maneras:
//   - other_invoice: la NC se aplica a OTRA factura como medio de pago.
//     Caso DP. Body: { type, appliedToInvoiceId }.
//   - cash_refund: el proveedor te devolvió la plata en efectivo.
//     Caso Sodimac. Body: { type }.
//   - bank_refund: el proveedor te devolvió la plata a tu cuenta bancaria.
//     Body: { type, refundBankMovementId }.
//   - split: la NC se PARTE entre una factura y el banco.
//     Body: { type, appliedToInvoiceId, appliedAmount, refundBankMovementId,
//     refundAmount }. Caso Comercial Hispano: la NC por la mercadería devuelta
//     paga la factura del retiro y el resto vuelve en un depósito. Los dos
//     pedazos tienen que sumar el total de la NC (ver validarSplit).
//
// En los cuatro casos la NC queda fuera del "saldo pendiente" visual. La
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
      data.type === "bank_refund" ||
      data.type === "split"
        ? data.type
        : null;

    const nc = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        tipoDoc: true,
        totalAmount: true,
        appliedToInvoiceId: true,
        refundBankMovementId: true,
      },
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
    const previousMovId = nc.refundBankMovementId;
    const ncAbs = Math.abs(nc.totalAmount);

    const updates: {
      compensationType: string | null;
      appliedToInvoiceId: string | null;
      appliedAmount: number | null;
      refundBankMovementId: string | null;
      refundAmount: number | null;
      status: string;
      paidAt: Date | null;
    } = {
      compensationType: type,
      appliedToInvoiceId: null,
      appliedAmount: null,
      refundBankMovementId: null,
      refundAmount: null,
      // Al compensar (any modo), la NC sale del pendiente. Al limpiar
      // (type=null), vuelve a "pendiente" para que aparezca en stats.
      status: type ? "pagada" : "pendiente",
      paidAt: type ? new Date() : null,
    };

    // Los dos destinos se validan igual vengan de un modo simple o del split.
    // La diferencia es solo si llevan monto propio: en los modos simples va
    // TODO a ese destino y el monto queda null ("se lee como el total").
    if (type === "other_invoice" || type === "split") {
      const targetId = String(data.appliedToInvoiceId ?? "");
      if (!targetId) {
        return NextResponse.json(
          { error: "Falta la factura a la que se aplica la nota de crédito" },
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

    if (type === "bank_refund" || type === "split") {
      const movId = String(data.refundBankMovementId ?? "");
      if (!movId) {
        return NextResponse.json(
          { error: "Falta el movimiento del banco donde volvió la plata" },
          { status: 400 }
        );
      }
      const mov = await prisma.bankMovement.findUnique({
        where: { id: movId },
        select: { id: true, amount: true, status: true, category: true },
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
    }

    // Reparto del split: los dos pedazos tienen que sumar el total de la NC.
    if (type === "split") {
      const aFactura = Number(data.appliedAmount);
      const alBanco = Number(data.refundAmount);
      const problema = validarSplit(ncAbs, aFactura, alBanco);
      if (problema) {
        return NextResponse.json({ error: problema }, { status: 400 });
      }
      updates.appliedAmount = aFactura;
      updates.refundAmount = alBanco;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        compensationType: true,
        appliedToInvoiceId: true,
        appliedAmount: true,
        refundBankMovementId: true,
        refundAmount: true,
      },
    });

    // Los movimientos del banco involucrados (el nuevo y el que se soltó) se
    // recalculan en vez de escribirles el status a mano: la cuenta ya sabe
    // sumar las NC que vuelven por un movimiento, y un mismo depósito puede
    // traer NC de VARIAS obras — el de Comercial Hispano trae la de
    // JNC-Vitacura y la de Portofino, y recién con las dos queda saldado.
    const movsATocar = [updates.refundBankMovementId, previousMovId].filter(
      (m): m is string => Boolean(m)
    );
    if (updates.refundBankMovementId) {
      // Rótulo del movimiento: es plata que devolvió un proveedor, no un
      // ingreso de obra. Solo se pone si no tenía categoría propia.
      await prisma.bankMovement.updateMany({
        where: { id: updates.refundBankMovementId, category: null },
        data: { category: "reembolso_proveedor" },
      });
    }
    await recomputeMovementsStatus(movsATocar);

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
        // Lo que esta NC aporta a ESTA factura: su pedazo cuando está partida,
        // el total cuando va entera.
        const ncAplicado = updates.appliedAmount ?? ncAbs;
        if (realPaid >= target.totalAmount - 10) {
          // CASO 1 — la factura ya estaba pagada entera por el banco antes
          // de la NC. La NC es una DEVOLUCIÓN, no anula la factura: queda
          // "pagada". La seteamos explícita (recompute saltaría si quedó
          // "anulada" por el bug viejo, y no la corregiría).
          await prisma.invoice.update({
            where: { id: newTargetId },
            data: { status: "pagada" },
          });
        } else if (realPaid + ncAplicado >= target.totalAmount - 10) {
          // CASOS 2/3 — la NC + lo pagado cubren el total:
          //  - Caso 2: pagaste una parte real → SALDADA = "pagada".
          //  - Caso 3: no pagaste nada → la compra se deshizo entera = "anulada".
          //
          // OJO con "anulada" cuando la NC viene PARTIDA: ahí el pedazo que
          // toca esta factura la cubre justo, y la factura es un cobro real que
          // se saldó con el crédito — no una compra que se deshizo. Por eso
          // "anulada" queda solo para la NC entera sin pagos.
          const seDeshizo = realPaid <= 0 && updates.appliedAmount === null;
          await prisma.invoice.update({
            where: { id: newTargetId },
            data: { status: seDeshizo ? "anulada" : "pagada", paidAt: new Date() },
          });
        } else {
          // CASO 4 — NC chica, todavía debés saldo → parcial.
          await recomputeInvoiceStatus(newTargetId);
          if (realPaid <= 0 && ncAplicado > 0) {
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
