import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";

// POST /api/banco/movimientos/bulk
//
// Acciones masivas sobre movimientos bancarios. MJ las usa para "rehacer
// la conciliación" cuando un lote quedó mal imputado.
//
//   { action: "desasignar", movementIds: [] }
//      → borra todos los InvoicePayment de esos movs y los devuelve a
//        status "sin_asignar". Las facturas que pierden imputación
//        recalculan su status (pueden volver a pendiente/parcial).
//
//   { action: "asignar", movementIds: [], invoiceId }
//      → imputa cada mov elegido a la factura, cada uno como un pago por
//        su monto completo (|amount|). Si el mov ya tenía imputaciones,
//        se reemplazan (replace, no se suma). status del mov → conciliado.
//
// No toca movimientos "interno".
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<{
      action: "desasignar" | "asignar";
      movementIds: string[];
      invoiceId: string;
    }>;

    const action = body.action;
    const movementIds = body.movementIds ?? [];
    if (action !== "desasignar" && action !== "asignar") {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    if (movementIds.length === 0) {
      return NextResponse.json({ error: "Sin movimientos seleccionados" }, { status: 400 });
    }

    const movs = await prisma.bankMovement.findMany({
      where: { id: { in: movementIds } },
      include: { payments: { select: { invoiceId: true } } },
    });
    // Internos no participan de imputaciones — se descartan en silencio.
    const targetMovs = movs.filter((m) => m.status !== "interno");
    if (targetMovs.length === 0) {
      return NextResponse.json(
        { error: "Ningún movimiento seleccionado es imputable (¿todos internos?)" },
        { status: 400 }
      );
    }

    // ── DESASIGNAR ─────────────────────────────────────────────────────
    if (action === "desasignar") {
      const ids = targetMovs.map((m) => m.id);
      // Facturas que van a perder imputación — recalcular su status después.
      const affectedInvoiceIds = Array.from(
        new Set(targetMovs.flatMap((m) => m.payments.map((p) => p.invoiceId)))
      );

      await prisma.$transaction([
        prisma.invoicePayment.deleteMany({ where: { bankMovementId: { in: ids } } }),
        prisma.bankMovement.updateMany({
          where: { id: { in: ids } },
          data: { status: "sin_asignar" },
        }),
      ]);

      for (const invId of affectedInvoiceIds) {
        await recomputeInvoiceStatus(invId);
      }

      return NextResponse.json({ ok: true, desasignados: ids.length });
    }

    // ── ASIGNAR A FACTURA ──────────────────────────────────────────────
    const invoiceId = body.invoiceId;
    if (!invoiceId) {
      return NextResponse.json({ error: "Falta la factura destino" }, { status: 400 });
    }
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      return NextResponse.json({ error: "La factura no existe" }, { status: 404 });
    }

    const ids = targetMovs.map((m) => m.id);
    // Imputaciones previas que se reemplazan — esas facturas también
    // recalculan status (pueden quedar con menos cobrado que antes).
    const previousInvoiceIds = targetMovs.flatMap((m) =>
      m.payments.map((p) => p.invoiceId)
    );
    const affectedInvoiceIds = Array.from(
      new Set([invoiceId, ...previousInvoiceIds])
    );

    await prisma.$transaction([
      // Replace: borrar lo que tuvieran y crear un pago por mov.
      prisma.invoicePayment.deleteMany({ where: { bankMovementId: { in: ids } } }),
      ...targetMovs.map((m) =>
        prisma.invoicePayment.create({
          data: {
            bankMovementId: m.id,
            invoiceId,
            amountApplied: Math.abs(m.amount),
          },
        })
      ),
      // Mov totalmente imputado a una factura → conciliado. Se limpia la
      // categoría (la factura tiene la suya).
      prisma.bankMovement.updateMany({
        where: { id: { in: ids } },
        data: { status: "conciliado", category: null },
      }),
    ]);

    for (const invId of affectedInvoiceIds) {
      await recomputeInvoiceStatus(invId);
    }

    return NextResponse.json({ ok: true, asignados: ids.length });
  } catch (error) {
    console.error("Error bulk movimientos:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
