import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  tryAutoMatchMovementWithInvoices,
  loadReembolsadores,
  loadCandidateInvoices,
} from "@/lib/banco/invoicePayments";
import { requireSession } from "@/lib/apiAuth";

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
// Detalle de UN match recién hecho, para que MJ pueda revisar la corrida y
// deshacer si algo calzó mal. Incluye lo mínimo para juzgar de un vistazo:
// qué movimiento (fecha, monto, descripción) pagó qué factura (folio,
// proveedor, total) y el paymentId para poder deshacer desde el panel.
interface MatchDetail {
  paymentId: string;
  invoiceId: string;
  folioNumber: string | null;
  businessName: string | null;
  invoiceTotal: number;
  amountApplied: number;
  movDate: string; // ISO
  movAmount: number;
  movDescription: string;
}

// Devuelve: { tried, matched, byReason: {...}, matches: MatchDetail[] }
export async function POST() {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  // Traemos los movimientos COMPLETOS (no solo los ids) en UNA sola query,
  // con los campos que el match necesita + sus pagos. Así la función no hace
  // un findUnique por movimiento (eran cientos de viajes a la BD remota).
  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      description: true,
      counterpartyRut: true,
      date: true,
      category: true, // para borrar el rótulo pago-a-socio al conciliar (ver invoicePayments)
      payments: { select: { id: true } },
    },
  });

  const stats = {
    tried: movs.length,
    matched: 0,
    byReason: {} as Record<string, number>,
    matches: [] as MatchDetail[],
  };

  // Precargamos UNA sola vez los datos que antes se consultaban por cada
  // movimiento (eran el cuello de botella: ~2 min con 200+ movs):
  //   - reembolsadores (lista chica, para alias de RUT).
  //   - facturas candidatas (pendientes/parciales con sus pagos).
  // El match filtra en memoria. `consumidas` lleva las facturas ya imputadas
  // en esta corrida para no asignar dos movimientos a la misma factura (la
  // lista en memoria no ve los pagos que el propio batch va creando).
  const reembolsadores = await loadReembolsadores();
  const candidateInvoices = await loadCandidateInvoices();
  const consumidas = new Set<string>();

  for (const mov of movs) {
    const r = await tryAutoMatchMovementWithInvoices(mov.id, reembolsadores, {
      invoices: candidateInvoices,
      excludeInvoiceIds: consumidas,
      movement: mov,
    });
    if (r.matched && r.invoiceId) {
      consumidas.add(r.invoiceId);
      stats.matched++;
      // Re-consultamos el payment recién creado + sus relaciones para armar
      // el detalle. Buscamos por (movId, invoiceId) que es la unique key.
      const pay = await prisma.invoicePayment.findFirst({
        where: { bankMovementId: mov.id, invoiceId: r.invoiceId },
        select: {
          id: true,
          amountApplied: true,
          invoice: {
            select: { id: true, folioNumber: true, businessName: true, totalAmount: true },
          },
          bankMovement: {
            select: { date: true, amount: true, description: true },
          },
        },
      });
      if (pay) {
        stats.matches.push({
          paymentId: pay.id,
          invoiceId: pay.invoice.id,
          folioNumber: pay.invoice.folioNumber,
          businessName: pay.invoice.businessName,
          invoiceTotal: pay.invoice.totalAmount,
          amountApplied: pay.amountApplied,
          movDate: pay.bankMovement.date.toISOString(),
          movAmount: pay.bankMovement.amount,
          movDescription: pay.bankMovement.description,
        });
      }
    } else {
      const reason = r.reason ?? "unknown";
      stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
    }
  }

  return NextResponse.json(stats);
}
