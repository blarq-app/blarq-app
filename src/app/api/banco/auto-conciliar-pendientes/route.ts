import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { tryAutoMatchMovementWithInvoices } from "@/lib/banco/invoicePayments";

// POST /api/banco/auto-conciliar-pendientes
//
// Aplica retroactivamente la lógica de auto-match a todos los movimientos
// bancarios sin imputaciones que están en estado "sin_asignar" o
// "sin_factura". Útil para limpiar movs viejos que en su momento no
// calzaron con una factura (porque la factura SII todavía no había llegado,
// o había ambigüedad).
//
// Usa la función compartida `tryAutoMatchMovementWithInvoices` (única fuente
// de verdad del auto-match): valida por RUT (directo o vía alias de
// reembolsador) o, para compras con tarjeta sin RUT, por nombre de comercio
// dentro de una ventana de fecha. Ante la duda deja pendiente. Antes este
// endpoint tenía su propia copia inline con el bug "1 candidato sin chequear
// RUT" — se eliminó al unificar.
//
// Cada match se commitea en su propia llamada y re-consulta la BD, así no se
// duplica una factura entre dos movimientos (el segundo ya la ve pagada).
//
// Devuelve: { tried, matched, byReason: {...} }
export async function POST() {
  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: { id: true },
  });

  const stats = {
    tried: movs.length,
    matched: 0,
    byReason: {} as Record<string, number>,
  };

  for (const mov of movs) {
    const r = await tryAutoMatchMovementWithInvoices(mov.id);
    if (r.matched) {
      stats.matched++;
    } else {
      const reason = r.reason ?? "unknown";
      stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
    }
  }

  return NextResponse.json(stats);
}
