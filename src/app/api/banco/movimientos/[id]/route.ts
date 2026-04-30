import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// PATCH /api/banco/movimientos/[id]
//
// Asigna un movimiento bancario manualmente. Acepta:
//   { invoiceId: string }       → vincular a factura, marcar factura como "pagada"
//   { category: string }        → categorizar como sueldo/previred/etc (sin factura)
//   { status: "interno", internalTransferToId: string } → marcar como transfer interno
//   { ignore: true }            → marcar como "sin_factura" sin categoría (= "ignorar")
//
// Side-effect: cuando se asigna invoiceId, la factura pasa a status="pagada" y
// paidAt = movement.date. Cuando se desvincula (invoiceId: null), la factura
// vuelve a "pendiente".
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      invoiceId: string | null;
      category: string | null;
      status: string;
      internalTransferToId: string | null;
      ignore: boolean;
      notes: string;
    }>;

    const mov = await prisma.bankMovement.findUnique({ where: { id } });
    if (!mov) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });

    // Si está cambiando la factura linkeada, manejar el side-effect:
    // - Desvincular la factura previa (vuelve a "pendiente")
    // - Vincular la nueva (pasa a "pagada")
    if (body.invoiceId !== undefined) {
      if (mov.invoiceId && mov.invoiceId !== body.invoiceId) {
        await prisma.invoice.update({
          where: { id: mov.invoiceId },
          data: { status: "pendiente", paidAt: null },
        });
      }
      if (body.invoiceId) {
        const inv = await prisma.invoice.findUnique({ where: { id: body.invoiceId } });
        if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
        await prisma.invoice.update({
          where: { id: body.invoiceId },
          data: { status: "pagada", paidAt: mov.date },
        });
      }
    }

    const update: Record<string, unknown> = {};
    if (body.invoiceId !== undefined) {
      update.invoiceId = body.invoiceId;
      update.status = body.invoiceId ? "conciliado" : "sin_asignar";
      // Al asignar a factura, limpiar categoría (la factura ya tiene la suya)
      if (body.invoiceId) update.category = null;
    }
    if (body.category !== undefined) {
      update.category = body.category;
      update.status = body.category ? "sin_factura" : "sin_asignar";
    }
    if (body.ignore) {
      update.status = "sin_factura";
      update.category = "otro_sin_factura";
    }
    if (body.notes !== undefined) update.notes = body.notes;

    const updated = await prisma.bankMovement.update({ where: { id }, data: update });
    return NextResponse.json({ ok: true, movement: updated });
  } catch (error) {
    console.error("Error patch movement:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
