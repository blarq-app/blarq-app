import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";
import { upsertRuleFromMovement } from "@/lib/banco/categorizationRules";
import { requireSession } from "@/lib/apiAuth";

// PATCH /api/banco/movimientos/[id]
//
// Asigna un movimiento bancario manualmente. Acepta:
//   { payments: [{ invoiceId, amountApplied }] }
//                              → reemplaza TODAS las imputaciones del mov.
//                                Permite splits ($7M abono → $5M factura A
//                                + $2M factura B). Si payments=[], desvincula
//                                todo y vuelve a sin_asignar.
//   { invoiceId: string }      → atajo: imputar el mov completo (|amount|)
//                                contra una factura. Equivalente a payments
//                                con un solo elemento.
//   { invoiceId: null }        → atajo: desvincular todo. Equivalente a
//                                payments=[].
//   { category: string }       → categorizar como sueldo/previred/etc (sin factura).
//                                Por sí solo NO crea regla de auto-categorización.
//   { category, saveRule:true } → además guarda una regla para que movs futuros
//                                con descripción similar se categoricen solos.
//                                Opt-in: el patrón se deriva de la glosa y puede
//                                quedar amplio (ej "Transf a Juan"), por eso no
//                                es el default.
//   { ignore: true }           → marcar como "sin_factura" sin categoría
//   { markInternal: true }     → marcar como transferencia interna BLARQ↔BLARQ
//   { notes: string }          → agregar nota
//
// Cuando se cambia la imputación, las facturas previa y nueva
// recalculan su status (pendiente/parcial/pagada) automáticamente.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      payments: Array<{ invoiceId: string; amountApplied: number }>;
      invoiceId: string | null;
      category: string | null;
      saveRule: boolean;
      ignore: boolean;
      markInternal: boolean;
      notes: string;
    }>;

    const mov = await prisma.bankMovement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!mov) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });

    // Normalizar el atajo invoiceId al shape de payments[].
    let nextPayments: Array<{ invoiceId: string; amountApplied: number }> | undefined;
    if (body.payments !== undefined) {
      nextPayments = body.payments;
    } else if (body.invoiceId !== undefined) {
      nextPayments = body.invoiceId
        ? [{ invoiceId: body.invoiceId, amountApplied: Math.abs(mov.amount) }]
        : [];
    }

    // Si está cambiando la imputación, validar y aplicar.
    if (nextPayments !== undefined) {
      // Validaciones
      const absAmount = Math.abs(mov.amount);
      const sumApplied = nextPayments.reduce((s, p) => s + p.amountApplied, 0);
      if (sumApplied > absAmount + 1) {
        return NextResponse.json(
          { error: `Suma de imputaciones (${sumApplied}) excede el monto del movimiento (${absAmount})` },
          { status: 400 }
        );
      }
      if (nextPayments.some((p) => p.amountApplied <= 0)) {
        return NextResponse.json({ error: "Cada amountApplied debe ser positivo" }, { status: 400 });
      }
      // Validar que las facturas existen
      if (nextPayments.length > 0) {
        const ids = nextPayments.map((p) => p.invoiceId);
        const existing = await prisma.invoice.count({ where: { id: { in: ids } } });
        if (existing !== ids.length) {
          return NextResponse.json({ error: "Alguna factura no existe" }, { status: 400 });
        }
      }

      // Facturas previas afectadas (para recalcular su status después).
      const previousInvoiceIds = mov.payments.map((p) => p.invoiceId);
      const nextInvoiceIds = nextPayments.map((p) => p.invoiceId);
      const affectedInvoiceIds = Array.from(new Set([...previousInvoiceIds, ...nextInvoiceIds]));

      // Replace transaccional: delete + create todos los pagos del mov.
      await prisma.$transaction([
        prisma.invoicePayment.deleteMany({ where: { bankMovementId: id } }),
        ...nextPayments.map((p) =>
          prisma.invoicePayment.create({
            data: {
              bankMovementId: id,
              invoiceId: p.invoiceId,
              amountApplied: p.amountApplied,
            },
          })
        ),
      ]);

      // Recalcular status de TODAS las facturas afectadas (las que perdieron
      // imputación pueden volver a pendiente, las nuevas pueden pasar a
      // parcial o pagada).
      for (const invId of affectedInvoiceIds) {
        await recomputeInvoiceStatus(invId);
      }
    }

    // Status del movimiento + otros campos.
    //   sin_asignar : 0 imputado
    //   parcial     : 0 < imputado < |amount|  (todavía hay saldo libre)
    //   conciliado  : imputado >= |amount|     (totalmente imputado)
    const update: Record<string, unknown> = {};
    if (nextPayments !== undefined) {
      const sumApplied = nextPayments.reduce((s, p) => s + p.amountApplied, 0);
      const absAmount = Math.abs(mov.amount);
      if (sumApplied <= 0) update.status = "sin_asignar";
      else if (sumApplied >= absAmount - 1) update.status = "conciliado";
      else update.status = "parcial";
      // Limpiar categoría cuando se imputa a factura (la factura tiene su propia categoría).
      if (nextPayments.length > 0) update.category = null;
    }
    if (body.category !== undefined) {
      update.category = body.category;
      update.status = body.category ? "sin_factura" : "sin_asignar";
      // La regla de auto-categorización solo se crea si MJ lo pide explícito
      // (saveRule). El patrón se deriva de la glosa y puede quedar amplio
      // ("Transf a Juan" atraparía a cualquier Juan), por eso es opt-in.
      if (body.category && body.saveRule) {
        await upsertRuleFromMovement(mov.description, body.category).catch(() => {});
      }
    }
    if (body.ignore) {
      update.status = "sin_factura";
      update.category = "otro_sin_factura";
    }
    if (body.markInternal) {
      // Transfer interna BLARQ↔BLARQ. Limpia categoría — se identifica por
      // el status. NO crea regla porque la detección por descripción ya la
      // hace el parser de cartola.
      update.status = "interno";
      update.category = null;
    }
    if (body.notes !== undefined) update.notes = body.notes;

    const updated = await prisma.bankMovement.update({
      where: { id },
      data: update,
      include: { payments: { include: { invoice: { select: { folioNumber: true, businessName: true, totalAmount: true, status: true } } } } },
    });
    return NextResponse.json({ ok: true, movement: updated });
  } catch (error) {
    console.error("Error patch movement:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
